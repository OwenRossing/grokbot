import fs from 'node:fs';
import path from 'node:path';
import { listImagePolicyOverrides } from '../memory.js';

const POLICY_CACHE_TTL_MS = 30_000;
let cachedPolicy = null;
let cachedAt = 0;

function parseEnvInt(value, fallback) {
  const n = Number.parseInt(value || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  }
  return fallback;
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function loadPolicyFile() {
  const policyPath = path.resolve(process.cwd(), 'config/image-policy.json');
  try {
    const raw = fs.readFileSync(policyPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildBasePolicy() {
  const now = Date.now();
  if (cachedPolicy && now - cachedAt < POLICY_CACHE_TTL_MS) return cachedPolicy;

  const fromFile = loadPolicyFile();
  const defaults = {
    enabled: true,
    maxPromptChars: parseEnvInt(process.env.IMAGE_GEN_MAX_PROMPT_CHARS, 1200),
    userDailyLimit: parseEnvInt(process.env.IMAGE_GEN_DAILY_USER_LIMIT, 20),
    guildDailyLimit: parseEnvInt(process.env.IMAGE_GEN_DAILY_GUILD_LIMIT, 500),
    blockedTerms: [],
    deniedUserIds: [],
    allowedUserIds: [],
    deniedGuildIds: [],
    allowedGuildIds: [],
  };

  cachedPolicy = {
    enabled: toBool(fromFile.enabled, defaults.enabled),
    maxPromptChars: parseEnvInt(fromFile.maxPromptChars, defaults.maxPromptChars),
    userDailyLimit: parseEnvInt(fromFile.userDailyLimit, defaults.userDailyLimit),
    guildDailyLimit: parseEnvInt(fromFile.guildDailyLimit, defaults.guildDailyLimit),
    blockedTerms: toStringList(fromFile.blockedTerms),
    deniedUserIds: toStringList(fromFile.deniedUserIds),
    allowedUserIds: toStringList(fromFile.allowedUserIds),
    deniedGuildIds: toStringList(fromFile.deniedGuildIds),
    allowedGuildIds: toStringList(fromFile.allowedGuildIds),
  };
  cachedAt = now;
  return cachedPolicy;
}

function overridesToMap(rows) {
  const map = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

function applyMap(policy, map) {
  if (Object.prototype.hasOwnProperty.call(map, 'enabled')) {
    policy.enabled = toBool(map.enabled, policy.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(map, 'max_prompt_chars')) {
    policy.maxPromptChars = parseEnvInt(map.max_prompt_chars, policy.maxPromptChars);
  }
  if (Object.prototype.hasOwnProperty.call(map, 'user_daily_limit')) {
    policy.userDailyLimit = parseEnvInt(map.user_daily_limit, policy.userDailyLimit);
  }
  if (Object.prototype.hasOwnProperty.call(map, 'guild_daily_limit')) {
    policy.guildDailyLimit = parseEnvInt(map.guild_daily_limit, policy.guildDailyLimit);
  }
  if (Object.prototype.hasOwnProperty.call(map, 'blocked_terms')) {
    policy.blockedTerms = toStringList(map.blocked_terms);
  }
  if (Object.prototype.hasOwnProperty.call(map, 'mode')) {
    policy.mode = String(map.mode || '').toLowerCase();
  }
}

export function getImagePolicy({ guildId, userId }) {
  const base = { ...buildBasePolicy(), mode: 'default' };
  if (guildId) {
    applyMap(base, overridesToMap(listImagePolicyOverrides('guild', guildId)));
  }
  if (userId) {
    applyMap(base, overridesToMap(listImagePolicyOverrides('user', userId)));
  }
  return base;
}

export function evaluateImagePrompt(prompt, policy, { guildId, userId }) {
  const p = (prompt || '').trim();
  if (!policy.enabled && policy.mode !== 'allow') {
    return { ok: false, code: 'DISABLED', message: 'Image generation is currently disabled by admins.' };
  }
  if (policy.mode === 'deny') {
    return { ok: false, code: 'DENY_OVERRIDE', message: 'You are not allowed to use image generation.' };
  }

  const userIdStr = String(userId || '').toLowerCase();
  const guildIdStr = String(guildId || '').toLowerCase();
  const userAllowed = policy.allowedUserIds.includes(userIdStr);
  const userDenied = policy.deniedUserIds.includes(userIdStr);
  const guildAllowed = guildIdStr ? policy.allowedGuildIds.includes(guildIdStr) : false;
  const guildDenied = guildIdStr ? policy.deniedGuildIds.includes(guildIdStr) : false;

  if (userDenied || guildDenied) {
    return { ok: false, code: 'DENY_LIST', message: 'Image generation is blocked by server policy.' };
  }
  if (policy.allowedUserIds.length && !userAllowed) {
    return { ok: false, code: 'ALLOWLIST_USER', message: 'Image generation is currently limited to approved users.' };
  }
  if (guildIdStr && policy.allowedGuildIds.length && !guildAllowed) {
    return { ok: false, code: 'ALLOWLIST_GUILD', message: 'Image generation is not enabled for this server.' };
  }
  if (p.length > policy.maxPromptChars) {
    return {
      ok: false,
      code: 'PROMPT_TOO_LONG',
      message: `Prompt is too long. Limit is ${policy.maxPromptChars} characters.`,
    };
  }

  const lowerPrompt = p.toLowerCase();
  const hit = policy.blockedTerms.find((term) => term && lowerPrompt.includes(term));
  if (hit) {
    return {
      ok: false,
      code: 'BLOCKED_TERM',
      message: 'That request is blocked by server image policy. Try a different prompt.',
    };
  }

  const bypassQuota = policy.mode === 'allow' || userAllowed;
  return { ok: true, code: 'OK', bypassQuota };
}

export function parseImagePolicyValue(key, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  switch (key) {
    case 'enabled':
      if (!['true', 'false', '1', '0', 'on', 'off'].includes(value.toLowerCase())) return null;
      return value;
    case 'max_prompt_chars':
    case 'user_daily_limit':
    case 'guild_daily_limit': {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return String(n);
    }
    case 'blocked_terms':
      return value;
    case 'mode':
      if (!['allow', 'deny', 'default'].includes(value.toLowerCase())) return null;
      return value.toLowerCase();
    default:
      return null;
  }
}

export function formatPolicySummary(policy) {
  const terms = policy.blockedTerms.length ? policy.blockedTerms.join(', ') : 'none';
  return [
    `enabled: ${policy.enabled}`,
    `userDailyLimit: ${policy.userDailyLimit}`,
    `guildDailyLimit: ${policy.guildDailyLimit}`,
    `maxPromptChars: ${policy.maxPromptChars}`,
    `mode: ${policy.mode || 'default'}`,
    `blockedTerms: ${terms}`,
  ].join('\n');
}
