import { isSafeHttpsUrl } from '../utils/validators.js';
import { MAX_IMAGE_BYTES, IMAGE_MIME, MEDIA_CACHE_TTL_MS } from '../utils/constants.js';
import { isGif, gifToPngSequence } from './gifProcessor.js';
import { videoToPngStoryboard } from './videoProcessor.js';

const GIF_EXT = /\.gif(\?.*)?$/i;
const mediaFrameCache = new Map();
const resolvedUrlCache = new Map();
const failedFetchCache = new Map();

function isRecentFailure(url) {
  const entry = failedFetchCache.get(url);
  if (!entry) return false;
  if (Date.now() - entry.at > MEDIA_CACHE_TTL_MS) {
    failedFetchCache.delete(url);
    return false;
  }
  return true;
}

function markFailure(url, reason) {
  failedFetchCache.set(url, { at: Date.now(), reason });
}

function isDiscordCdnHost(hostname) {
  const lower = hostname.toLowerCase();
  return (
    lower.endsWith('discordapp.com') ||
    lower.endsWith('discordapp.net')
  );
}

function getDiscordStaticUrl(rawUrl, format) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isDiscordCdnHost(parsed.hostname)) return null;
  parsed.hostname = 'media.discordapp.net';
  parsed.searchParams.set('format', format);
  parsed.searchParams.set('width', '512');
  parsed.searchParams.set('height', '512');
  return parsed.toString();
}

function getImageUrlCandidates(url) {
  const candidates = [url];
  if (GIF_EXT.test(url)) {
    const formats = ['png', 'webp', 'jpeg'];
    for (const format of formats) {
      const transformed = getDiscordStaticUrl(url, format);
      if (transformed) candidates.push(transformed);
    }
  }
  return Array.from(new Set(candidates));
}

async function fetchImageCandidateAsDataUrl(url) {
  if (isRecentFailure(url)) {
    console.warn('Skipping recent failed image URL:', url);
    return null;
  }
  const safe = await isSafeHttpsUrl(url);
  if (!safe) {
    console.warn('Image fetch blocked (unsafe URL):', url);
    markFailure(url, 'unsafe');
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      console.warn('Image fetch failed:', url, response.status);
      markFailure(url, `status:${response.status}`);
      return null;
    }
    if (response.url && response.url !== url) {
      const redirectSafe = await isSafeHttpsUrl(response.url);
      if (!redirectSafe) {
        console.warn('Image fetch blocked (unsafe redirect):', response.url);
        markFailure(url, 'unsafe-redirect');
        return null;
      }
    }
    const contentType = response.headers.get('content-type')?.split(';')[0] || '';
    const isGifType = contentType === 'image/gif' || url.toLowerCase().endsWith('.gif');

    // Prefer inlining static formats; defer GIFs to a final passthrough.
    if (isGifType) {
      return null;
    }

    if (!IMAGE_MIME.includes(contentType)) {
      console.warn('Image fetch rejected (invalid content-type):', contentType, url);
      markFailure(url, `content-type:${contentType}`);
      return null;
    }

    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) {
      console.warn('Image fetch rejected (too large):', lengthHeader, url);
      markFailure(url, 'too-large');
      return null;
    }
    if (!response.body) {
      console.warn('Image fetch failed (empty body):', url);
      markFailure(url, 'empty-body');
      return null;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) {
        console.warn('Image fetch rejected (stream too large):', total, url);
        markFailure(url, 'stream-too-large');
        return null;
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString('base64');
    const mimeType = contentType || 'image/png';
    failedFetchCache.delete(url);
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error('Image fetch threw error:', url, err);
    markFailure(url, 'exception');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchImageAsDataUrl(url, resolveDirectMediaUrl) {
  const resolved = await resolveDirectMediaUrl(url);
  const finalUrl = resolved || url;
  const candidates = getImageUrlCandidates(finalUrl);
  for (const candidate of candidates) {
    const dataUrl = await fetchImageCandidateAsDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }
  if (GIF_EXT.test(finalUrl)) {
    const safe = await isSafeHttpsUrl(finalUrl);
    if (safe) {
      console.info('GIF passthrough for vision:', finalUrl);
      return finalUrl;
    }
  }
  return null;
}

function parseGiphyIdFromUrl(u) {
  try {
    const url = new URL(u);
    if (!/giphy\.com$/i.test(url.hostname) && !/media\.giphy\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'media' && parts[1]) return parts[1];
    if (parts[0] === 'gifs' && parts[1]) {
      const m = parts[1].match(/-([A-Za-z0-9]+)$/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

function buildGiphyDirectUrl(id) {
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

async function resolveGiphyDirect(u, giphyApiKey) {
  try {
    const url = new URL(u);
    if (!/giphy\.com$/i.test(url.hostname) && !/media\.giphy\.com$/i.test(url.hostname)) return null;
  } catch {
    return null;
  }
  if (!giphyApiKey) {
    console.warn('GIPHY_API_KEY not set — Giphy URL resolution disabled');
    return null;
  }
  try {
    const giphyId = parseGiphyIdFromUrl(u);
    if (!giphyId) return null;
    return buildGiphyDirectUrl(giphyId);
  } catch (err) {
    console.error('Giphy direct resolution failed:', err);
    return null;
  }
}

export async function resolveDirectMediaUrl(u, giphyApiKey) {
  const cached = resolvedUrlCache.get(u);
  if (cached && Date.now() - cached.at < MEDIA_CACHE_TTL_MS) {
    return cached.value;
  }
  const imageExt = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;
  if (imageExt.test(u)) {
    resolvedUrlCache.set(u, { value: u, at: Date.now() });
    return u;
  }
  const giphyId = parseGiphyIdFromUrl(u);
  if (giphyId) {
    const direct = buildGiphyDirectUrl(giphyId);
    resolvedUrlCache.set(u, { value: direct, at: Date.now() });
    return direct;
  }
  const giphy = await resolveGiphyDirect(u, giphyApiKey);
  if (giphy) {
    resolvedUrlCache.set(u, { value: giphy, at: Date.now() });
    return giphy;
  }
  resolvedUrlCache.set(u, { value: null, at: Date.now() });
  return null;
}

export async function searchGiphyGif(query, giphyApiKey) {
  if (!giphyApiKey) {
    console.warn('GIPHY_API_KEY not set — Giphy GIFs disabled');
    return null;
  }
  try {
    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', giphyApiKey);
    url.searchParams.set('limit', '1');
    url.searchParams.set('rating', 'g');
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.data?.[0];
    const directUrl = item?.url || null;
    if (!directUrl) return null;
    const giphyId = directUrl.split('-').pop();
    return buildGiphyDirectUrl(giphyId);
  } catch (err) {
    console.error('Giphy API search failed:', err);
    return null;
  }
}

export async function getReplyContext(message) {
  const replyId = message.reference?.messageId;
  if (!replyId) return null;
  try {
    const referenced = await message.channel.messages.fetch(replyId);
    const text = referenced.content?.trim() || '';
    const { normalizeMediaFromMessage } = await import('../utils/media.js');
    const media = normalizeMediaFromMessage(referenced);
    return {
      author: referenced.author?.username || 'Unknown',
      text,
      media,
    };
  } catch {
    return null;
  }
}

export async function processGifUrl(url) {
  if (isRecentFailure(url)) return null;
  const cached = mediaFrameCache.get(url);
  if (cached && Date.now() - cached.at < MEDIA_CACHE_TTL_MS) {
    return cached.frames;
  }
  const isGifUrl = await isGif(url);
  if (!isGifUrl) return null;
  try {
    const frames = await gifToPngSequence(url);
    if (frames.length) {
      mediaFrameCache.set(url, { frames, at: Date.now() });
      failedFetchCache.delete(url);
    }
    return frames.length > 0 ? frames : null;
  } catch (err) {
    console.error('Failed to process GIF:', err);
    markFailure(url, 'gif-process');
    return null;
  }
}

export async function processVideoUrl(url) {
  if (isRecentFailure(url)) return null;
  const cached = mediaFrameCache.get(url);
  if (cached && Date.now() - cached.at < MEDIA_CACHE_TTL_MS) {
    return cached.frames;
  }
  try {
    const frames = await videoToPngStoryboard(url);
    if (frames.length) {
      mediaFrameCache.set(url, { frames, at: Date.now() });
      failedFetchCache.delete(url);
    }
    return frames.length > 0 ? frames : null;
  } catch (err) {
    console.error('Failed to process video:', err);
    markFailure(url, 'video-process');
    return null;
  }
}
