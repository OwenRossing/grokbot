function safeText(value = '') {
  return String(value || '').trim();
}

export function buildConversationTurnKey({ channelType, guildId, channelId, userId }) {
  if (channelType === 'dm' || !guildId) {
    return `dm:${userId}`;
  }
  return `guild:${guildId}:${channelId}:${userId}`;
}

export function buildReplySearchText(replyContext) {
  if (!replyContext) return '';
  const lines = [];
  if (replyContext.authorDisplayName) {
    lines.push(`Reply target: ${replyContext.authorDisplayName}`);
  }
  if (replyContext.text) {
    lines.push(replyContext.text);
  }
  if ((replyContext.media || []).some((item) => item?.type === 'video')) {
    lines.push('[video referenced]');
  }
  return lines.join(' ').trim();
}

function formatWindowMessage(message, currentUserId) {
  const author = message.authorDisplayName || message.authorUsername || 'Unknown';
  const marker = message.authorId && currentUserId && message.authorId === currentUserId
    ? ' (current user)'
    : '';
  const ref = message.isReferenceTarget ? ' [replied-to message]' : '';
  const content = safeText(message.text) || '[no text]';
  return `- ${author}${marker}${ref}: ${content}`;
}

export function buildReplyContextBlock(replyContext, currentUser = {}) {
  if (!replyContext) return '';

  const authorName = replyContext.authorDisplayName || replyContext.authorUsername || 'Unknown';
  const lines = [
    'Reply context:',
    `- Current speaker: ${currentUser.displayName || currentUser.userName || 'Unknown'}`,
    `- Replied-to author: ${authorName}`,
  ];

  if (currentUser.id && replyContext.authorId) {
    lines.push(`- Replied-to author is current speaker: ${replyContext.authorId === currentUser.id ? 'yes' : 'no'}`);
  }

  lines.push(`- Replied-to text: ${safeText(replyContext.text) || '[no text]'}`);

  const windowMessages = Array.isArray(replyContext.messages)
    ? replyContext.messages.map((message) => formatWindowMessage(message, currentUser.id)).filter(Boolean)
    : [];

  if (windowMessages.length) {
    lines.push('Local conversation window:');
    lines.push(...windowMessages);
  }

  return lines.join('\n');
}
