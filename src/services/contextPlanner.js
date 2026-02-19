import {
  getProfileSummary,
  getRecentMessages,
  getRecentChannelMessages,
  getChannelSummary,
  getGuildSummary,
  getGuildUserNames,
  getServerContext,
  getUserContext,
  searchMemory,
} from '../memory.js';

function normalizePrompt(prompt) {
  return String(prompt || '').trim();
}

function tokenize(prompt) {
  return normalizePrompt(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function isAmbiguousPrompt(prompt) {
  const p = normalizePrompt(prompt).toLowerCase();
  if (!p) return true;
  if (p.length <= 14) return true;
  return /(that|this|it|same|before|again|what he said|what she said|as above)/i.test(p);
}

function shouldTrimContext(prompt, hasMedia = false, replyContextText = '') {
  const p = normalizePrompt(prompt);
  return p.length > 0 && p.length <= 12 && !hasMedia && !replyContextText;
}

function formatHit(hit) {
  const ts = new Date(hit.created_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `[${ts}] @${hit.display_name}: ${hit.content}`;
}

function scoreConfidence({ replyContextText, recentUserMessages, recentChannelMessages, channelHits, guildHits }) {
  let score = 0;
  if (replyContextText) score += 0.5;
  if ((recentUserMessages || []).length) score += 0.2;
  if ((recentChannelMessages || []).length) score += 0.15;
  if ((channelHits || []).length) score += 0.25;
  if ((guildHits || []).length) score += 0.3;
  return Math.min(1, score);
}

export async function buildContextBundle({
  userId,
  guildId,
  channelId,
  prompt,
  replyContextText,
  allowMemory,
  hasMedia = false,
  reportStatus,
}) {
  const trimmedPrompt = normalizePrompt(prompt);
  const trimContext = shouldTrimContext(trimmedPrompt, hasMedia, replyContextText);
  const tokens = tokenize(trimmedPrompt);

  const bundle = {
    profileSummary: '',
    recentUserMessages: [],
    recentChannelMessages: [],
    channelSummary: '',
    guildSummary: '',
    knownUsers: [],
    serverContext: null,
    userContext: null,
    retrievedContextBlocks: [],
    retrievalMeta: {
      used: false,
      escalatedToChannel: false,
      escalatedToGuild: false,
      channelHits: 0,
      guildHits: 0,
      confidence: 0,
    },
  };

  if (!allowMemory || trimContext) {
    return bundle;
  }

  bundle.profileSummary = getProfileSummary(userId);
  bundle.recentUserMessages = getRecentMessages(userId, 3);
  if (channelId) {
    bundle.recentChannelMessages = getRecentChannelMessages(channelId, userId, 3);
    bundle.channelSummary = getChannelSummary(channelId);
  }
  if (guildId) {
    bundle.guildSummary = getGuildSummary(guildId);
    bundle.knownUsers = getGuildUserNames(guildId, 12);
    bundle.serverContext = getServerContext(guildId);
    bundle.userContext = getUserContext(guildId, userId);
  }

  const needsEscalation = isAmbiguousPrompt(trimmedPrompt) || !replyContextText;
  if (!needsEscalation || !tokens.length) {
    bundle.retrievalMeta.confidence = scoreConfidence({
      replyContextText,
      recentUserMessages: bundle.recentUserMessages,
      recentChannelMessages: bundle.recentChannelMessages,
      channelHits: [],
      guildHits: [],
    });
    return bundle;
  }

  if (reportStatus) {
    await reportStatus('Searching memory', { phase: 'channel', scope: 'channel' });
  }

  const channelHits = channelId
    ? searchMemory({
      guildId,
      channelId,
      userId,
      query: trimmedPrompt,
      scope: 'channel',
      limit: 4,
      respectPolicy: true,
    })
    : [];

  bundle.retrievalMeta.used = true;
  bundle.retrievalMeta.escalatedToChannel = true;
  bundle.retrievalMeta.channelHits = channelHits.length;

  if (channelHits.length) {
    bundle.retrievedContextBlocks.push(
      `Relevant channel history:\n${channelHits.map((h) => `- ${formatHit(h)}`).join('\n')}`
    );
  }

  let guildHits = [];
  let confidence = scoreConfidence({
    replyContextText,
    recentUserMessages: bundle.recentUserMessages,
    recentChannelMessages: bundle.recentChannelMessages,
    channelHits,
    guildHits,
  });

  if (confidence < 0.8 && guildId) {
    if (reportStatus) {
      await reportStatus('Searching memory', { phase: 'guild', scope: 'guild' });
    }
    guildHits = searchMemory({
      guildId,
      channelId,
      userId,
      query: trimmedPrompt,
      scope: 'guild',
      limit: 4,
      respectPolicy: true,
    });
    bundle.retrievalMeta.escalatedToGuild = true;
    bundle.retrievalMeta.guildHits = guildHits.length;
    if (guildHits.length) {
      bundle.retrievedContextBlocks.push(
        `Relevant server history:\n${guildHits.map((h) => `- ${formatHit(h)}`).join('\n')}`
      );
    }

    confidence = scoreConfidence({
      replyContextText,
      recentUserMessages: bundle.recentUserMessages,
      recentChannelMessages: bundle.recentChannelMessages,
      channelHits,
      guildHits,
    });
  }

  bundle.retrievalMeta.confidence = confidence;
  return bundle;
}
