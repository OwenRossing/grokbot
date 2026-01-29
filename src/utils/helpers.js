import fs from 'node:fs';
import path from 'node:path';

export function addTurn(inMemoryTurns, userId, role, content) {
  const turns = inMemoryTurns.get(userId) || [];
  const updated = [...turns, { role, content }].slice(-6);
  inMemoryTurns.set(userId, updated);
  return updated;
}

const metrics = new Map();

export function trackMetric(name, delta = 1) {
  const current = metrics.get(name) || 0;
  const next = current + delta;
  metrics.set(name, next);
  if (next % 50 === 0) {
    console.info(`[metrics] ${name}=${next}`);
  }
}

export function logContextSignal(label, payload) {
  try {
    const safePayload = payload ? JSON.stringify(payload) : '';
    console.info(`[context] ${label}${safePayload ? ` ${safePayload}` : ''}`);
  } catch (err) {
    console.info(`[context] ${label}`);
  }
}

export function isDM(message) {
  return message.channel?.isDMBased?.() || message.guildId === null;
}

export function shouldRecordMemoryMessage(content, hasMedia) {
  if (hasMedia) return true;
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.length < 4) return false;
  if (/^(lol|ok|k|ty|thx|lmao|lmfao|idk|np)$/i.test(trimmed)) return false;
  return true;
}

export function cleanupTmpDir(rootDir = process.cwd()) {
  try {
    const tmpDir = path.join(rootDir, 'tmp');
    if (!fs.existsSync(tmpDir)) return;
    for (const entry of fs.readdirSync(tmpDir)) {
      const full = path.join(tmpDir, entry);
      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch {}
    }
  } catch (err) {
    console.warn('Failed to cleanup tmp directory:', err.message);
  }
}

export function getMissingEnvVars(requiredVars = []) {
  return requiredVars.filter((key) => !process.env[key]);
}

export async function safeExecute(label, fn, context) {
  try {
    await fn();
  } catch (err) {
    console.error(`Handler error (${label}):`, err);

    if (!context) {
      return;
    }

    try {
      if (typeof context.isRepliable === 'function' && context.isRepliable()) {
        const replyPayload = {
          content: 'An unexpected error occurred while processing your request. Please try again later.',
          ephemeral: true,
        };

        if (context.deferred || context.replied) {
          await context.followUp(replyPayload);
        } else {
          await context.reply(replyPayload);
        }
        return;
      }

      if (typeof context.reply === 'function') {
        await context.reply('An unexpected error occurred while processing your request. Please try again later.');
      }
    } catch (notifyErr) {
      console.error('Failed to send error response to user:', notifyErr);
    }
  }
}

export function setupProcessGuards(client, options = {}) {
  const onShutdown = typeof options.onShutdown === 'function' ? options.onShutdown : null;

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing Discord client.');
    if (onShutdown) {
      try {
        onShutdown();
      } catch {}
    }
    client.destroy();
  });
  process.on('SIGINT', () => {
    console.log('SIGINT received. Closing Discord client.');
    if (onShutdown) {
      try {
        onShutdown();
      } catch {}
    }
    client.destroy();
  });
}
