import net from 'node:net';
import dns from 'node:dns/promises';
import { MAX_IMAGE_BYTES, IMAGE_MIME, IMAGE_EXT, VIDEO_EXT, VIDEO_MIME_PREFIXES } from './constants.js';

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
  }
  return false;
}

export async function isSafeHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (net.isIP(parsed.hostname) && isPrivateIp(parsed.hostname)) return false;
  if (parsed.hostname.toLowerCase() === 'localhost') return false;
  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    return records.every((record) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

export function isImageAttachment(attachment) {
  if (!attachment?.url) return false;
  if (attachment.contentType && attachment.contentType.startsWith('image/')) {
    return true;
  }
  return IMAGE_EXT.test(attachment.url) || IMAGE_EXT.test(attachment.name || '');
}

export function isVideoAttachment(attachment) {
  if (!attachment?.url) return false;
  if (attachment.contentType && VIDEO_MIME_PREFIXES.some((p) => attachment.contentType.startsWith(p))) {
    return true;
  }
  return VIDEO_EXT.test(attachment.url) || VIDEO_EXT.test(attachment.name || '');
}

export function extractImageUrlsFromText(text) {
  if (!text) return [];
  const matches = text.match(/https:\/\/[^\s<>()]+/gi) || [];
  return matches
    .map((raw) => raw.replace(/[)>.,!?:;]+$/, ''))
    .filter((url) => IMAGE_EXT.test(url));
}

export function extractImageUrlsFromEmbeds(embeds = []) {
  const urls = [];
  for (const embed of embeds) {
    if (embed?.image?.url) urls.push(embed.image.url);
    if (embed?.thumbnail?.url) urls.push(embed.thumbnail.url);
  }
  return urls;
}

export function getMessageImageUrls(message) {
  const urls = [];
  for (const attachment of message.attachments?.values?.() || []) {
    if (isImageAttachment(attachment)) {
      urls.push(attachment.url);
    }
  }
  urls.push(...extractImageUrlsFromText(message.content || ''));
  urls.push(...extractImageUrlsFromEmbeds(message.embeds));
  return Array.from(new Set(urls));
}

export function getMessageVideoUrls(message) {
  const urls = [];
  for (const attachment of message.attachments?.values?.() || []) {
    if (isVideoAttachment(attachment)) {
      urls.push(attachment.url);
    }
  }
  if (message.content) {
    const matches = message.content.match(/https:\/\/[^\s<>()]+/gi) || [];
    for (const raw of matches) {
      const url = raw.replace(/[)>.,!?:;]+$/, '');
      if (VIDEO_EXT.test(url)) urls.push(url);
    }
  }
  return Array.from(new Set(urls));
}

export function containsHateSpeech(text) {
  const banned = [
    /\b(?:nazi|kkk)\b/i,
    /\b(?:faggot|tranny|nigger|cuntface)\b/i,
  ];
  return banned.some((pattern) => pattern.test(text));
}

export function stripMention(content, clientId) {
  if (!clientId) return content;
  const regex = new RegExp(`<@!?${clientId}>`, 'g');
  return content.replace(regex, '').trim();
}

export function parseDuration(input) {
  if (!input) return 24 * 60 * 60 * 1000;
  const m = String(input).trim().match(/^(\d+)(m|h|d)$/i);
  if (!m) return 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export function parseQuotedPoll(text) {
  const match = text.match(/poll\s+((?:\"[^\"]+\"\s*)+)(?:--duration\s+(\S+))?/i);
  if (!match) return null;
  const quoted = Array.from(match[1].matchAll(/\"([^\"]+)\"/g)).map(m => m[1]);
  if (quoted.length < 3) return null;
  const question = quoted[0];
  const options = quoted.slice(1).slice(0, 10);
  const duration = parseDuration(match[2] || '24h');
  return { question, options, duration, multi: false };
}
