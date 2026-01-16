const COOLDOWN_MS = 10000;

const state = new Map();

/**
 * Check if a user should be rate-limited.
 * - Users must wait 10 seconds between prompts
 * - Duplicate messages are immediately blocked (stricter than previous implementation)
 */
export function checkRateLimit(userId, prompt) {
  const now = Date.now();
  const entry = state.get(userId) || {
    lastAt: 0,
    lastPrompt: '',
    duplicateCount: 0,
  };

  if (now - entry.lastAt < COOLDOWN_MS) {
    // Immediately block duplicate messages (no grace period)
    if (prompt === entry.lastPrompt) {
      entry.duplicateCount += 1;
      state.set(userId, entry);
      return { allow: false, message: '-# stop spamming twin im only replying once' };
    }
    state.set(userId, entry);
    return { allow: false, message: '-# chill for 10s then try again' };
  }

  entry.lastAt = now;
  entry.lastPrompt = prompt;
  entry.duplicateCount = 0;
  state.set(userId, entry);
  return { allow: true };
}

export function resetRateLimit(userId) {
  state.delete(userId);
}
