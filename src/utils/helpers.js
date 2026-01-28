export function addTurn(inMemoryTurns, userId, role, content) {
  const turns = inMemoryTurns.get(userId) || [];
  const updated = [...turns, { role, content }].slice(-6);
  inMemoryTurns.set(userId, updated);
  return updated;
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

export function setupProcessGuards(client) {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing Discord client.');
    client.destroy();
  });
  process.on('SIGINT', () => {
    console.log('SIGINT received. Closing Discord client.');
    client.destroy();
  });
}
