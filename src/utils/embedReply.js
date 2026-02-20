const EMBED_DESC_LIMIT = 4096;
const MAX_HEADER_LEN = 140;

function normalizeHeader(value = '') {
  const header = String(value || '').trim();
  if (!header) return '';
  if (header.length <= MAX_HEADER_LEN) return header;
  return `${header.slice(0, MAX_HEADER_LEN - 1)}…`;
}

export function buildEmbed({ title = 'Response', description = '', fields = [], footer, image, url } = {}) {
  const embed = {
    title: String(title || 'Response').slice(0, 256),
    description: String(description || '').slice(0, EMBED_DESC_LIMIT),
    fields: Array.isArray(fields) ? fields.slice(0, 25) : [],
    timestamp: new Date().toISOString(),
  };
  if (footer) embed.footer = { text: String(footer).slice(0, 2048) };
  if (image) embed.image = { url: String(image) };
  if (url) embed.url = String(url);
  return embed;
}

function normalizePayloadInput(payload) {
  if (typeof payload === 'string') return { content: payload };
  if (!payload || typeof payload !== 'object') return { content: '' };
  return { ...payload };
}

function toOverflowAttachment(text) {
  return {
    attachment: Buffer.from(String(text || ''), 'utf8'),
    name: 'details.txt',
  };
}

export function ensureEmbedPayload(payload, { defaultTitle = 'Response', source = 'unknown' } = {}) {
  const next = normalizePayloadInput(payload);
  const existingEmbeds = Array.isArray(next.embeds) ? next.embeds : [];
  const hasEmbeds = existingEmbeds.length > 0;
  const rawContent = String(next.content || '');

  if (process.env.NODE_ENV !== 'production' && rawContent.trim() && !hasEmbeds) {
    console.warn(`[embed-reply] Non-embed payload detected at ${source}; converting to embed.`);
  }

  if (hasEmbeds) {
    const header = normalizeHeader(rawContent);
    next.content = header || '';
    next.embeds = existingEmbeds;
    return next;
  }

  let description = rawContent.trim();
  let overflow = '';
  if (description.length > EMBED_DESC_LIMIT) {
    overflow = description;
    description = `${description.slice(0, EMBED_DESC_LIMIT - 1)}…`;
  }
  const embed = buildEmbed({
    title: defaultTitle,
    description: description || 'Done.',
  });

  const files = Array.isArray(next.files) ? [...next.files] : [];
  if (overflow) files.push(toOverflowAttachment(overflow));

  return {
    ...next,
    content: '',
    embeds: [embed],
    files,
  };
}

export function wrapInteractionForEmbedReplies(interaction, { defaultTitle = 'Response' } = {}) {
  const methodNames = new Set(['reply', 'editReply', 'followUp', 'update']);
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (!methodNames.has(String(prop)) || typeof value !== 'function') return value;
      return (...args) => {
        const [payload, ...rest] = args;
        const normalized = ensureEmbedPayload(payload, {
          defaultTitle,
          source: `interaction.${String(prop)}`,
        });
        return value.call(target, normalized, ...rest);
      };
    },
  });
}

export function wrapMessageForEmbedReplies(message, { defaultTitle = 'Response' } = {}) {
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (prop === 'reply') {
        const reply = Reflect.get(target, prop, receiver);
        if (typeof reply !== 'function') return reply;
        return (...args) => {
          const [payload, ...rest] = args;
          const normalized = ensureEmbedPayload(payload, {
            defaultTitle,
            source: 'message.reply',
          });
          return reply.call(target, normalized, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function replyEmbed(interactionOrMessage, { embed, components = [], files = [], ephemeral, contentHeader = '' } = {}) {
  const payload = ensureEmbedPayload(
    {
      content: contentHeader || '',
      embeds: embed ? [embed] : [],
      components,
      files,
      ...(ephemeral === undefined ? {} : { ephemeral }),
    },
    { defaultTitle: 'Response', source: 'replyEmbed' }
  );
  if (typeof interactionOrMessage.reply === 'function') {
    return interactionOrMessage.reply(payload);
  }
  throw new Error('replyEmbed target does not support reply()');
}

