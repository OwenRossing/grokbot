const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'how', 'i', 'if', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'so', 'that',
  'the', 'to', 'was', 'we', 'when', 'with', 'you', 'your',
]);

const PROTECTED_KEYWORDS = new Set([
  'pack', 'packs', 'cooldown', 'claim', 'open', 'inventory', 'collection',
  'card', 'cards', 'set', 'tcg', 'pokemon',
]);

const PLACEHOLDER = '[EMPHASIS_REMOVED]';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeUserTextForLlm(text) {
  const original = String(text || '');
  const normalized = original.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) {
    return { sanitized: original, removedTokens: [] };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { sanitized: original, removedTokens: [] };
  }

  const counts = new Map();
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    if (PROTECTED_KEYWORDS.has(token)) continue;
    const next = (counts.get(token) || 0) + 1;
    counts.set(token, next);
  }

  const spamTokens = [];
  for (const [token, count] of counts.entries()) {
    if (count >= 3 && (count / tokens.length) >= 0.2) {
      spamTokens.push(token);
    }
  }

  if (!spamTokens.length) {
    return { sanitized: original, removedTokens: [] };
  }

  let sanitized = original;
  for (const token of spamTokens) {
    const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
    sanitized = sanitized.replace(pattern, ' ');
  }
  sanitized = sanitized
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();

  if (!sanitized) sanitized = PLACEHOLDER;
  else sanitized = `${PLACEHOLDER} ${sanitized}`;

  return {
    sanitized,
    removedTokens: spamTokens,
  };
}

