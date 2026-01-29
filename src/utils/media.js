import { IMAGE_EXT, VIDEO_EXT } from './constants.js';
import { isImageAttachment, isVideoAttachment } from './validators.js';

const URL_REGEX = /https:\/\/[^\s<>()]+/gi;
const GIF_EXT = /\.gif(\?.*)?$/i;

function normalizeUrl(raw) {
  if (!raw) return null;
  return raw.replace(/[)>.,!?:;]+$/, '');
}

function detectMediaType({ url, mime }) {
  if (!url) return 'unknown';
  if (mime?.startsWith?.('video/')) return 'video';
  if (mime?.startsWith?.('image/gif')) return 'gif';
  if (mime?.startsWith?.('image/')) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  if (GIF_EXT.test(url)) return 'gif';
  if (IMAGE_EXT.test(url)) return 'image';
  return 'unknown';
}

function addMediaItem(queue, seen, item) {
  if (!item?.url) return;
  const key = item.url.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  queue.push(item);
}

export function normalizeMediaFromMessage(message) {
  const mediaQueue = [];
  const seen = new Set();

  for (const attachment of message.attachments?.values?.() || []) {
    if (!attachment?.url) continue;
    let type = 'unknown';
    if (isVideoAttachment(attachment)) {
      type = 'video';
    } else if (attachment.contentType?.startsWith?.('image/gif')) {
      type = 'gif';
    } else if (isImageAttachment(attachment)) {
      type = 'image';
    } else {
      type = detectMediaType({ url: attachment.url, mime: attachment.contentType });
    }
    addMediaItem(mediaQueue, seen, {
      type,
      url: attachment.url,
      mime: attachment.contentType || '',
      source: 'attachment',
      duration: attachment.duration || null,
      frameCount: null,
    });
  }

  for (const embed of message.embeds || []) {
    if (embed?.image?.url) {
      addMediaItem(mediaQueue, seen, {
        type: detectMediaType({ url: embed.image.url, mime: '' }),
        url: embed.image.url,
        mime: '',
        source: 'embed:image',
        duration: null,
        frameCount: null,
      });
    }
    if (embed?.thumbnail?.url) {
      addMediaItem(mediaQueue, seen, {
        type: detectMediaType({ url: embed.thumbnail.url, mime: '' }),
        url: embed.thumbnail.url,
        mime: '',
        source: 'embed:thumbnail',
        duration: null,
        frameCount: null,
      });
    }
    if (embed?.video?.url) {
      addMediaItem(mediaQueue, seen, {
        type: detectMediaType({ url: embed.video.url, mime: embed.video?.contentType || '' }),
        url: embed.video.url,
        mime: embed.video?.contentType || '',
        source: 'embed:video',
        duration: embed.video?.duration || null,
        frameCount: null,
      });
    }
  }

  const content = message.content || '';
  const matches = content.match(URL_REGEX) || [];
  for (const raw of matches) {
    const url = normalizeUrl(raw);
    if (!url) continue;
    const type = detectMediaType({ url, mime: '' });
    if (type === 'unknown') continue;
    addMediaItem(mediaQueue, seen, {
      type,
      url,
      mime: '',
      source: 'content',
      duration: null,
      frameCount: null,
    });
  }

  return mediaQueue;
}

export function mergeMediaQueues(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const item of primary) {
    addMediaItem(merged, seen, item);
  }
  for (const item of secondary) {
    addMediaItem(merged, seen, item);
  }
  return merged;
}

export function summarizeMediaQueue(mediaQueue = []) {
  const summary = {
    total: mediaQueue.length,
    imageCount: 0,
    gifCount: 0,
    videoCount: 0,
    unknownCount: 0,
  };
  for (const item of mediaQueue) {
    if (item.type === 'image') summary.imageCount += 1;
    else if (item.type === 'gif') summary.gifCount += 1;
    else if (item.type === 'video') summary.videoCount += 1;
    else summary.unknownCount += 1;
  }
  return summary;
}
