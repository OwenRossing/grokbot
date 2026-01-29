import { checkRateLimit } from '../rateLimit.js';
import { getUserSettings, queueUserMessage, getProfileSummary, getRecentMessages, getRecentChannelMessages, getChannelSummary, getGuildSummary, getGuildUserNames, trackBotMessage, getServerContext, getUserContext } from '../memory.js';
import { fetchImageAsDataUrl, resolveDirectMediaUrl, processGifUrl, processVideoUrl } from '../services/media.js';
import { getLLMResponse } from '../llm.js';
import { MAX_MEDIA_INPUTS, MAX_MEDIA_FRAMES_PER_ITEM } from '../utils/constants.js';
import { containsHateSpeech } from '../utils/validators.js';
import { logContextSignal, shouldRecordMemoryMessage, trackMetric } from '../utils/helpers.js';
import { summarizeMediaQueue } from '../utils/media.js';

const lastChannelSummary = new Map();
const lastChannelSummaryAt = new Map();
const lastGuildSummary = new Map();
const lastGuildSummaryAt = new Map();
const lastServerContext = new Map();
const lastServerContextAt = new Map();
const lastUserContext = new Map();
const lastUserContextAt = new Map();
const SUMMARY_REFRESH_MS = 10 * 60 * 1000;

function shouldAttachSummary(cacheMap, cacheTimeMap, key, summary) {
  if (!summary) return '';
  const now = Date.now();
  const last = cacheMap.get(key) || '';
  const lastAt = cacheTimeMap.get(key) || 0;
  if (last === summary && now - lastAt < SUMMARY_REFRESH_MS) {
    return '';
  }
  cacheMap.set(key, summary);
  cacheTimeMap.set(key, now);
  return summary;
}

function mentionsMedia(text) {
  if (!text) return false;
  return /(image|photo|picture|gif|video|clip|screenshot|see|look|show|this|that|these|those)/i.test(text);
}

export async function handlePrompt({
  userId,
  guildId,
  channelId,
  prompt,
  reply,
  replyContextText,
  mediaItems = [],
  allowMemory,
  alreadyRecorded = false,
  onTyping,
  displayName,
  userName,
  userGlobalName,
  channelType,
  inMemoryTurns,
  client,
}) {
  const mediaUrlsForRate = (mediaItems || []).map((item) => item.url);
  const rateKey = [prompt, replyContextText || '', ...mediaUrlsForRate].join('|');
  const rate = checkRateLimit(userId, rateKey);
  if (!rate.allow) {
    await reply(rate.message);
    return;
  }

  if (containsHateSpeech(prompt) || containsHateSpeech(replyContextText || '')) {
    await reply('nah, not touching that.');
    return;
  }

  const mediaSummary = summarizeMediaQueue(mediaItems);
  const mediaTraceId = mediaItems.length
    ? `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : '';
  if (mediaSummary.imageCount) trackMetric('media.image', mediaSummary.imageCount);
  if (mediaSummary.gifCount) trackMetric('media.gif', mediaSummary.gifCount);
  if (mediaSummary.videoCount) trackMetric('media.video', mediaSummary.videoCount);

  let settings = getUserSettings(userId);
  if (settings.memory_enabled && allowMemory && !alreadyRecorded && shouldRecordMemoryMessage(prompt, mediaSummary.total > 0)) {
    let memoryContent = prompt || '';
    if (!memoryContent && mediaSummary.imageCount) {
      memoryContent = `User sent ${mediaSummary.imageCount} image(s).`;
    } else if (mediaSummary.imageCount) {
      memoryContent = `${memoryContent} [shared ${mediaSummary.imageCount} image(s)]`;
    }
    if (!memoryContent && mediaSummary.gifCount) {
      memoryContent = `User sent ${mediaSummary.gifCount} gif(s).`;
    } else if (mediaSummary.gifCount) {
      memoryContent = `${memoryContent} [shared ${mediaSummary.gifCount} gif(s)]`;
    }
    if (!memoryContent && mediaSummary.videoCount) {
      memoryContent = `User sent ${mediaSummary.videoCount} video(s).`;
    } else if (mediaSummary.videoCount) {
      memoryContent = `${memoryContent} [shared ${mediaSummary.videoCount} video(s)]`;
    }
    if (!memoryContent && replyContextText) {
      memoryContent = 'User replied to a message.';
    }
    queueUserMessage({
      userId,
      channelId,
      guildId,
      content: memoryContent,
      displayName,
      username: userName,
      globalName: userGlobalName,
      channelType,
    });
    settings = getUserSettings(userId);
  }

  const trimmedPrompt = (prompt || '').trim();
  const trimContext = trimmedPrompt.length > 0 && trimmedPrompt.length <= 12 && mediaSummary.total === 0 && !replyContextText;
  const profileSummary = allowMemory && !trimContext ? getProfileSummary(userId) : '';
  const recentUserMessages = allowMemory && !trimContext ? getRecentMessages(userId, 3) : [];
  const recentChannelMessages =
    allowMemory && channelId && !trimContext ? getRecentChannelMessages(channelId, userId, 3) : [];
  const channelSummaryRaw =
    allowMemory && channelId && !trimContext ? getChannelSummary(channelId) : '';
  const guildSummaryRaw = allowMemory && guildId && !trimContext ? getGuildSummary(guildId) : '';
  const knownUsers = allowMemory && guildId && !trimContext ? getGuildUserNames(guildId, 12) : [];
  const serverContextRaw = allowMemory && guildId && !trimContext ? getServerContext(guildId) : null;
  const userContextRaw = allowMemory && guildId && !trimContext ? getUserContext(guildId, userId) : null;
  const channelSummary = channelId
    ? shouldAttachSummary(lastChannelSummary, lastChannelSummaryAt, channelId, channelSummaryRaw)
    : '';
  const guildSummary = guildId
    ? shouldAttachSummary(lastGuildSummary, lastGuildSummaryAt, guildId, guildSummaryRaw)
    : '';
  const serverContext = guildId
    ? shouldAttachSummary(lastServerContext, lastServerContextAt, guildId, serverContextRaw)
    : null;
  const userContextKey = guildId ? `${guildId}:${userId}` : '';
  const userContext = userContextKey
    ? shouldAttachSummary(lastUserContext, lastUserContextAt, userContextKey, userContextRaw)
    : null;
  const contextStack = {
    channelType: channelType || (guildId ? 'guild' : 'dm'),
    memoryEnabled: Boolean(settings.memory_enabled),
    memoryAllowed: Boolean(allowMemory),
    replyContext: Boolean(replyContextText),
    imageCount: mediaSummary.imageCount + mediaSummary.gifCount,
    videoCount: mediaSummary.videoCount,
    displayName,
    preferredName: settings.preferred_name || '',
    pronouns: settings.pronouns || '',
  };

  logContextSignal('prompt_context', {
    userId,
    guildId,
    channelId,
    channelType: contextStack.channelType,
    memoryEnabled: contextStack.memoryEnabled,
    memoryAllowed: contextStack.memoryAllowed,
    replyContext: contextStack.replyContext,
    imageCount: contextStack.imageCount,
    videoCount: contextStack.videoCount,
    modelHint: mediaItems.length ? 'vision' : 'text',
  });
  if (mediaItems.length) {
    logContextSignal('media_routing', {
      mediaTraceId,
      total: mediaSummary.total,
      images: mediaSummary.imageCount,
      gifs: mediaSummary.gifCount,
      videos: mediaSummary.videoCount,
    });
  }

  const imageInputs = [];
  const mediaNotes = [];
  const shouldProcessMedia = mediaItems?.length
    ? (!trimmedPrompt || mentionsMedia(trimmedPrompt))
    : false;
  if (mediaItems?.length && !shouldProcessMedia) {
    logContextSignal('media_skip', { reason: 'prompt_text_only', count: mediaItems.length });
  }
  if (mediaItems?.length && shouldProcessMedia) {
    for (const item of mediaItems) {
      if (imageInputs.length >= MAX_MEDIA_INPUTS) break;
      if (item.type === 'image') {
        const dataUrl = await fetchImageAsDataUrl(item.url, (u) => resolveDirectMediaUrl(u, process.env.GIPHY_API_KEY));
        if (dataUrl) {
          imageInputs.push(dataUrl);
        } else {
          mediaNotes.push(`Image: ${item.url}`);
        }
        continue;
      }
      if (item.type === 'gif') {
        const frames = await processGifUrl(item.url);
        if (frames?.length) {
          const remaining = MAX_MEDIA_INPUTS - imageInputs.length;
          imageInputs.push(...frames.slice(0, Math.min(remaining, MAX_MEDIA_FRAMES_PER_ITEM)));
        } else {
          const dataUrl = await fetchImageAsDataUrl(item.url, (u) => resolveDirectMediaUrl(u, process.env.GIPHY_API_KEY));
          if (dataUrl) {
            imageInputs.push(dataUrl);
          } else {
            mediaNotes.push(`GIF: ${item.url}`);
          }
        }
        continue;
      }
      if (item.type === 'video') {
        const frames = await processVideoUrl(item.url);
        if (frames?.length) {
          const remaining = MAX_MEDIA_INPUTS - imageInputs.length;
          imageInputs.push(...frames.slice(0, Math.min(remaining, MAX_MEDIA_FRAMES_PER_ITEM)));
        } else {
          mediaNotes.push(`Video: ${item.url}`);
        }
      }
    }
  }

  if (imageInputs.length) {
    console.info('Prepared image inputs for model:', imageInputs.map((v) => (typeof v === 'string' ? v.slice(0, 80) : v)));
  }
  if (mediaItems.length && imageInputs.length >= MAX_MEDIA_INPUTS) {
    console.info('Media inputs capped at MAX_MEDIA_INPUTS:', MAX_MEDIA_INPUTS);
  }
  
  let effectivePrompt = prompt;
  if (!effectivePrompt && imageInputs.length > 0) {
    effectivePrompt = 'User sent an image.';
  } else if (!effectivePrompt && mediaSummary.videoCount) {
    effectivePrompt = 'User referenced a video.';
  } else if (!effectivePrompt && replyContextText) {
    effectivePrompt = 'Following up on the replied message.';
  }

  // Surface unresolved media URLs to the model.
  if (mediaNotes.length) {
    const noteBlock = `Media URLs:\n- ${mediaNotes.slice(0, 5).join('\n- ')}`;
    effectivePrompt = effectivePrompt ? `${effectivePrompt}\n${noteBlock}` : noteBlock;
    console.info('Media URLs included in prompt:', mediaNotes);
  }
  
  function addTurn(role, content) {
    const turns = inMemoryTurns.get(userId) || [];
    const updated = [...turns, { role, content }].slice(-6);
    inMemoryTurns.set(userId, updated);
    return updated;
  }

  const recentTurns = allowMemory
    ? addTurn('user', effectivePrompt || '...')
    : [];
  if (onTyping) {
    await onTyping();
  }
  const response = await getLLMResponse({
    botName: process.env.BOT_NAME || 'GrokBuddy',
    profileSummary,
    recentTurns,
    userContent: effectivePrompt,
    replyContext: replyContextText,
    imageInputs,
    forceVision: mediaItems.length > 0,
    recentUserMessages,
    recentChannelMessages,
    channelSummary,
    guildSummary,
    knownUsers,
    serverContext,
    userContext,
    contextStack,
  });
  if (allowMemory) {
    addTurn('assistant', response);
    logContextSignal('memory_snapshot', {
      userId,
      preferredName: settings.preferred_name || '',
      pronouns: settings.pronouns || '',
      messageCount: settings.message_count || 0,
      lastSummaryAt: settings.last_summary_at || 0,
    });
  }
  await reply(response);
}
