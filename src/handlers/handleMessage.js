import { getUserSettings, isChannelAllowed, queueUserMessage, trackBotMessage } from '../memory.js';
import { getReplyId, shouldHandleEdit, trackReply as trackReplySync } from '../editSync.js';
import { handlePrompt } from './handlePrompt.js';
import { stripMention, parseQuotedPoll, containsHateSpeech } from '../utils/validators.js';
import { NUMBER_EMOJIS } from '../utils/constants.js';
import { createPoll, getPollByMessageId, recordVote, removeVote } from '../polls.js';
import { getReplyContext } from '../services/media.js';
import { routeIntent } from '../services/intentRouter.js';
import { mergeMediaQueues, normalizeMediaFromMessage } from '../utils/media.js';
import { shouldRecordMemoryMessage, trackMetric } from '../utils/helpers.js';
import { getRecentReactionContext } from '../services/reactionContext.js';

function normalizeReplyPayload(payload) {
  if (typeof payload === 'string') return { content: payload };
  if (!payload || typeof payload !== 'object') return { content: '' };
  return payload;
}

function wantsReactionMedia(text) {
  if (!text) return false;
  return /(remix|variation|recreate|restyle|edit this|use this image|use that image|based on (this|that))/i.test(text);
}

export async function handleMessage({ client, message, inMemoryTurns }) {
  if (message.author.bot) return;

  const isDirect = message.channel?.isDMBased?.() || message.guildId === null;
  const memoryChannel = isDirect || isChannelAllowed(message.channelId);
  const settings = getUserSettings(message.author.id);
  const allowMemoryContext = memoryChannel && settings.memory_enabled;
  const displayName = message.member?.displayName || message.author.globalName || message.author.username;
  const username = message.author.username;
  const globalName = message.author.globalName || '';
  
  const initialMediaItems = normalizeMediaFromMessage(message);
  const didRecordMemory = allowMemoryContext && shouldRecordMemoryMessage(message.content, initialMediaItems.length > 0);
  if (didRecordMemory) {
    queueUserMessage({
      userId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      content: message.content,
      displayName,
      username,
      globalName,
      channelType: isDirect ? 'dm' : 'guild',
    });
  }

  const mentioned = message.mentions.has(client.user);
  const autoreplyEnabled = settings.autoreply_enabled && message.guildId;
  
  // Only process if: DM, mentioned, or autoreply enabled
  if (!isDirect && !mentioned && !autoreplyEnabled) return;

  const content = isDirect ? message.content.trim() : mentioned ? stripMention(message.content, client.user.id) : message.content.trim();
  
  // Try to route simple cache-backed intents (owner, find user, role members, random)
  if (content && message.guildId) {
    const intentReply = await routeIntent(content, {
      guildId: message.guildId,
      userId: message.author.id,
      client,
    });
    if (intentReply) {
      await message.reply({ content: intentReply });
      return;
    }
  }
  
  // Inline poll creation
  if (mentioned) {
    const parsed = parseQuotedPoll(content);
    if (parsed) {
      const { question, options, duration } = parsed;
      if (options.length < 2) {
        await message.reply('Need at least two options.');
        return;
      }
      if (options.length > NUMBER_EMOJIS.length) {
        await message.reply(`Max ${NUMBER_EMOJIS.length} options.`);
        return;
      }
      const closeAt = Date.now() + duration;
      const pollMsg = await message.channel.send({
        content: `📊 ${question}\n\n${options.map((o, i) => `${NUMBER_EMOJIS[i]} ${o}`).join('\n')}\n\n⏳ closes <t:${Math.floor(closeAt/1000)}:R>`
      });
      trackBotMessage(pollMsg.id, pollMsg.channelId, pollMsg.guildId);
      for (let i = 0; i < options.length; i++) {
        await pollMsg.react(NUMBER_EMOJIS[i]);
      }
      createPoll({
        guildId: pollMsg.guildId || null,
        channelId: pollMsg.channelId,
        messageId: pollMsg.id,
        creatorId: message.author.id,
        question,
        options,
        multiVote: false,
        anonymous: false,
        closesAt: closeAt,
      });
      return;
    }
  }

  const replyContext = await getReplyContext(message);
  const replyContextText = replyContext
    ? `Reply context from ${replyContext.author}: ${replyContext.text || '[no text]'}${replyContext.media?.length ? ' [media attached]' : ''}`
    : '';

  let mediaItems = mergeMediaQueues(initialMediaItems, replyContext?.media || []);
  let effectiveReplyContextText = replyContextText;
  if (!mediaItems.length && wantsReactionMedia(content)) {
    const reactionContext = await getRecentReactionContext({
      client,
      userId: message.author.id,
      guildId: message.guildId,
      channelId: message.channelId,
    });
    if (reactionContext?.media?.length) {
      mediaItems = mergeMediaQueues(mediaItems, reactionContext.media);
      const reactionText = `Reacted context from ${reactionContext.author}: ${reactionContext.text || '[no text]'} [media attached]`;
      effectiveReplyContextText = effectiveReplyContextText
        ? `${effectiveReplyContextText}\n${reactionText}`
        : reactionText;
    }
  }

  if (mediaItems.length) {
    console.info('Collected media items:', mediaItems.map((item) => `${item.type}:${item.url}`));
    const counts = mediaItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    if (counts.image) trackMetric('media.image', counts.image);
    if (counts.gif) trackMetric('media.gif', counts.gif);
    if (counts.video) trackMetric('media.video', counts.video);
  }

  if (!content && !mediaItems.length && !effectiveReplyContextText) return;

  const replyFn = async (text) => {
    const payload = normalizeReplyPayload(text);
    let sent;
    try {
      sent = isDirect
        ? await message.channel.send(payload)
        : await message.reply(payload);
    } catch (err) {
      if (err?.code === 50013 && payload?.files?.length) {
        const fallback = { content: 'I need the `Attach Files` permission in this channel to send generated images.' };
        sent = isDirect
          ? await message.channel.send(fallback)
          : await message.reply(fallback);
      } else {
        throw err;
      }
    }
    trackReplySync({ userMessageId: message.id, botReplyId: sent.id });
    trackBotMessage(sent.id, message.channelId, message.guildId);
  };
  const typingFn = async () => {
    await message.channel.sendTyping();
  };

  await handlePrompt({
    userId: message.author.id,
    guildId: message.guildId,
    channelId: message.channelId,
    prompt: content,
    reply: replyFn,
    replyContextText: effectiveReplyContextText,
    mediaItems,
    allowMemory: allowMemoryContext,
    alreadyRecorded: didRecordMemory,
    onTyping: typingFn,
    displayName,
    userName: username,
    userGlobalName: globalName,
    channelType: isDirect ? 'dm' : 'guild',
    inMemoryTurns,
    client,
  });
}

export async function handleMessageUpdate({ client, newMessage, inMemoryTurns }) {
  if (!newMessage) return;
  const hydrated = newMessage.partial ? await newMessage.fetch() : newMessage;
  if (hydrated.author?.bot) return;

  const isDirect = hydrated.channel?.isDMBased?.() || hydrated.guildId === null;
  const memoryChannel = isDirect || isChannelAllowed(hydrated.channelId);
  const settings = getUserSettings(hydrated.author.id);
  const allowMemoryContext = memoryChannel && settings.memory_enabled;
  const displayName = hydrated.member?.displayName || hydrated.author.globalName || hydrated.author.username;
  const username = hydrated.author.username;
  const globalName = hydrated.author.globalName || '';

  const hydratedMediaItems = normalizeMediaFromMessage(hydrated);
  const didRecordHydrated = allowMemoryContext && shouldRecordMemoryMessage(hydrated.content, hydratedMediaItems.length > 0);
  if (didRecordHydrated) {
    queueUserMessage({
      userId: hydrated.author.id,
      channelId: hydrated.channelId,
      guildId: hydrated.guildId,
      content: hydrated.content,
      displayName,
      username,
      globalName,
      channelType: isDirect ? 'dm' : 'guild',
    });
  }

  if (!shouldHandleEdit(hydrated.id)) return;

  const mentioned = hydrated.mentions.has(client.user);
  if (!isDirect && !mentioned) return;

  const content = isDirect
    ? hydrated.content.trim()
    : stripMention(hydrated.content, client.user.id);
  const replyContext = await getReplyContext(hydrated);
  const replyContextText = replyContext
    ? `Reply context from ${replyContext.author}: ${replyContext.text || '[no text]'}${replyContext.media?.length ? ' [media attached]' : ''}`
    : '';
  let mediaItems = mergeMediaQueues(hydratedMediaItems, replyContext?.media || []);
  let effectiveReplyContextText = replyContextText;
  if (!mediaItems.length && wantsReactionMedia(content)) {
    const reactionContext = await getRecentReactionContext({
      client,
      userId: hydrated.author.id,
      guildId: hydrated.guildId,
      channelId: hydrated.channelId,
    });
    if (reactionContext?.media?.length) {
      mediaItems = mergeMediaQueues(mediaItems, reactionContext.media);
      const reactionText = `Reacted context from ${reactionContext.author}: ${reactionContext.text || '[no text]'} [media attached]`;
      effectiveReplyContextText = effectiveReplyContextText
        ? `${effectiveReplyContextText}\n${reactionText}`
        : reactionText;
    }
  }
  if (!content && !mediaItems.length && !effectiveReplyContextText) return;

  const replyId = getReplyId(hydrated.id);
  if (!replyId) return;

  const replyFn = async (text) => {
    const payload = normalizeReplyPayload(text);
    const messageToEdit = await hydrated.channel.messages.fetch(replyId);
    try {
      await messageToEdit.edit(payload);
    } catch (err) {
      if (err?.code === 50013 && payload?.files?.length) {
        await messageToEdit.edit({ content: 'I need the `Attach Files` permission in this channel to send generated images.' });
      } else {
        throw err;
      }
    }
  };
  const typingFn = async () => {
    await hydrated.channel.sendTyping();
  };

  await handlePrompt({
    userId: hydrated.author.id,
    guildId: hydrated.guildId,
    channelId: hydrated.channelId,
    prompt: content,
    reply: replyFn,
    replyContextText: effectiveReplyContextText,
    mediaItems,
    allowMemory: allowMemoryContext,
    alreadyRecorded: didRecordHydrated,
    onTyping: typingFn,
    displayName,
    userName: username,
    userGlobalName: globalName,
    channelType: isDirect ? 'dm' : 'guild',
    inMemoryTurns,
    client,
  });
}
