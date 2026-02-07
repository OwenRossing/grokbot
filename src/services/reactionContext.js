import { normalizeMediaFromMessage } from '../utils/media.js';

const REACTION_CONTEXT_TTL_MS = 30 * 60 * 1000;
const reactionTargets = new Map();

function keyFor(userId, guildId, channelId) {
  return `${userId}:${guildId || 'dm'}:${channelId || 'dm'}`;
}

export function setRecentReactionTarget({ userId, guildId, channelId, messageId }) {
  if (!userId || !channelId || !messageId) return;
  reactionTargets.set(keyFor(userId, guildId, channelId), {
    userId,
    guildId: guildId || null,
    channelId,
    messageId,
    at: Date.now(),
  });
}

function getRecentReactionTarget(userId, guildId, channelId) {
  const entry = reactionTargets.get(keyFor(userId, guildId, channelId));
  if (!entry) return null;
  if (Date.now() - entry.at > REACTION_CONTEXT_TTL_MS) {
    reactionTargets.delete(keyFor(userId, guildId, channelId));
    return null;
  }
  return entry;
}

export async function getRecentReactionContext({ client, userId, guildId, channelId }) {
  const entry = getRecentReactionTarget(userId, guildId, channelId);
  if (!entry) return null;
  try {
    const channel = await client.channels.fetch(entry.channelId);
    if (!channel?.messages?.fetch) return null;
    const message = await channel.messages.fetch(entry.messageId);
    const media = normalizeMediaFromMessage(message);
    if (!media.length) return null;
    return {
      author: message.author?.username || 'Unknown',
      text: message.content?.trim() || '',
      media,
    };
  } catch {
    return null;
  }
}

