import { checkRateLimit } from '../rateLimit.js';
import {
  getUserSettings,
  queueUserMessage,
  logSearchEvent,
} from '../memory.js';
import { fetchImageAsDataUrl, resolveDirectMediaUrl } from '../services/media.js';
import { buildContextBundle } from '../services/contextPlanner.js';
import { searchWeb, shouldAutoWebSearch } from '../services/webSearch/index.js';
import { getLLMResponse } from '../llm.js';
import { MAX_IMAGES } from '../utils/constants.js';
import { containsHateSpeech } from '../utils/validators.js';
import { shouldRecordMemoryMessage } from '../utils/helpers.js';

function addTurn(inMemoryTurns, userId, role, content) {
  const turns = inMemoryTurns.get(userId) || [];
  const updated = [...turns, { role, content }].slice(-6);
  inMemoryTurns.set(userId, updated);
  return updated;
}

export async function handlePrompt({
  userId,
  guildId,
  channelId,
  prompt,
  reply,
  replyContextText,
  imageUrls,
  videoUrls,
  allowMemory,
  alreadyRecorded = false,
  onTyping,
  onStatus,
  displayName,
  userName,
  userGlobalName,
  channelType,
  inMemoryTurns,
}) {
  const rateKey = [prompt, replyContextText || '', ...(imageUrls || []), ...(videoUrls || [])].join('|');
  const rate = checkRateLimit(userId, rateKey);
  if (!rate.allow) {
    await reply(rate.message);
    return;
  }

  if (containsHateSpeech(prompt) || containsHateSpeech(replyContextText || '')) {
    await reply('nah, not touching that.');
    return;
  }

  let settings = getUserSettings(userId);
  const hasMedia = Boolean((imageUrls && imageUrls.length) || (videoUrls && videoUrls.length));
  if (settings.memory_enabled && allowMemory && !alreadyRecorded && shouldRecordMemoryMessage(prompt, hasMedia)) {
    let memoryContent = prompt || '';
    if (!memoryContent && imageUrls?.length) {
      memoryContent = `User sent ${imageUrls.length} image(s).`;
    } else if (imageUrls?.length) {
      memoryContent = `${memoryContent} [shared ${imageUrls.length} image(s)]`;
    }
    if (!memoryContent && videoUrls?.length) {
      memoryContent = `User sent ${videoUrls.length} video(s).`;
    } else if (videoUrls?.length) {
      memoryContent = `${memoryContent} [shared ${videoUrls.length} video(s)]`;
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

  if (onTyping) {
    await onTyping();
  }
  if (onStatus && allowMemory) {
    await onStatus('Thinking', { phase: 'start' });
  }

  const contextBundle = await buildContextBundle({
    userId,
    guildId,
    channelId,
    prompt,
    replyContextText,
    allowMemory,
    hasMedia,
    reportStatus: onStatus,
  });
  if (contextBundle.retrievalMeta.used) {
    logSearchEvent({
      userId,
      guildId,
      mode: 'memory_auto',
      query: String(prompt || ''),
      provider: 'memory',
      latencyMs: 0,
      hitCount: (contextBundle.retrievalMeta.channelHits || 0) + (contextBundle.retrievalMeta.guildHits || 0),
    });
  }

  const imageInputs = [];
  if (imageUrls?.length) {
    for (const url of imageUrls.slice(0, MAX_IMAGES)) {
      const dataUrl = await fetchImageAsDataUrl(url, (u) => resolveDirectMediaUrl(u, process.env.GIPHY_API_KEY));
      if (dataUrl) {
        imageInputs.push(dataUrl);
      } else {
        console.warn('Image input dropped (failed to resolve):', url);
      }
    }
  }

  let effectivePrompt = prompt;
  if (!effectivePrompt && imageInputs.length > 0) {
    effectivePrompt = 'User sent an image.';
  } else if (!effectivePrompt && (videoUrls?.length || (replyContextText && replyContextText.includes('video')))) {
    effectivePrompt = 'User referenced a video.';
  } else if (!effectivePrompt && replyContextText) {
    effectivePrompt = 'Following up on the replied message.';
  }

  if (videoUrls?.length) {
    const videoNote = `Attached video URLs:\n- ${videoUrls.slice(0, 3).join('\n- ')}`;
    effectivePrompt = effectivePrompt ? `${effectivePrompt}\n${videoNote}` : videoNote;
  }

  const webSearchEnabled = process.env.WEB_SEARCH_ENABLED !== '0';
  let webSearchResults = [];
  if (webSearchEnabled && shouldAutoWebSearch(effectivePrompt)) {
    if (onStatus) {
      await onStatus('Searching web', { phase: 'web' });
    }
    const start = Date.now();
    const web = await searchWeb({ query: effectivePrompt, limit: 4 });
    if (web.ok) {
      webSearchResults = web.results;
    }
    logSearchEvent({
      userId,
      guildId,
      mode: 'web_auto',
      query: effectivePrompt || '',
      provider: web.provider || 'web',
      latencyMs: web.latencyMs || (Date.now() - start),
      hitCount: webSearchResults.length,
    });
  }

  const contextStack = {
    channelType: channelType || (guildId ? 'guild' : 'dm'),
    memoryEnabled: Boolean(settings.memory_enabled),
    memoryAllowed: Boolean(allowMemory),
    replyContext: Boolean(replyContextText),
    imageCount: imageUrls?.length || 0,
    videoCount: videoUrls?.length || 0,
    displayName,
    preferredName: settings.preferred_name || '',
    pronouns: settings.pronouns || '',
  };

  const recentTurns = allowMemory ? addTurn(inMemoryTurns, userId, 'user', effectivePrompt || '...') : [];

  if (onStatus) {
    await onStatus('Composing response', {
      memoryHits: (contextBundle.retrievalMeta.channelHits || 0) + (contextBundle.retrievalMeta.guildHits || 0),
      webHits: webSearchResults.length,
      escalationStep: contextBundle.retrievalMeta.escalatedToGuild
        ? 'guild'
        : contextBundle.retrievalMeta.escalatedToChannel
          ? 'channel'
          : 'local',
    });
  }

  const response = await getLLMResponse({
    botName: process.env.BOT_NAME || 'GrokBuddy',
    profileSummary: contextBundle.profileSummary,
    recentTurns,
    userContent: effectivePrompt,
    replyContext: replyContextText,
    imageInputs,
    recentUserMessages: contextBundle.recentUserMessages,
    recentChannelMessages: contextBundle.recentChannelMessages,
    channelSummary: contextBundle.channelSummary,
    guildSummary: contextBundle.guildSummary,
    knownUsers: contextBundle.knownUsers,
    serverContext: contextBundle.serverContext,
    userContext: contextBundle.userContext,
    contextStack,
    retrievedContextBlocks: contextBundle.retrievedContextBlocks,
    webSearchResults,
  });

  if (allowMemory) {
    addTurn(inMemoryTurns, userId, 'assistant', response);
  }

  await reply(response);

  if (onStatus) {
    await onStatus('Done', {
      memoryHits: (contextBundle.retrievalMeta.channelHits || 0) + (contextBundle.retrievalMeta.guildHits || 0),
      webHits: webSearchResults.length,
      confidence: contextBundle.retrievalMeta.confidence || 0,
    });
  }
}
