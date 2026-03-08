const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:0.5b-instruct';
const DEFAULT_OLLAMA_TIMEOUT_MS = 1500;
const MAX_TITLE_LEN = 120;
const MAX_SUBTITLE_LEN = 140;
const AI_MIN_QUALITY_SCORE = 0.68;
const OLLAMA_COOLDOWN_MS = 60 * 1000;

const ollamaState = {
  cooldownUntil: 0,
  lastError: '',
};

function now() {
  return Date.now();
}

function normalizeSpaces(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTitleCase(value = '') {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanTokenNoise(value = '') {
  let title = normalizeSpaces(value);
  title = title.replace(/[_|]+/g, ' ');
  title = title.replace(/\s*[-–—]+\s*/g, ' - ');
  title = title.replace(/\s+/g, ' ');
  title = title.replace(/\b(event|market)\s*[:\-]?\s*/ig, '');
  title = title.replace(/\b(yes|no)\s*price\b/ig, '');
  title = title.replace(/\b([A-Z]{2,8}-\d{1,4}[A-Z]*)\b/g, '');
  title = title.replace(/\b([A-Z]{2,10}_\d{2,6})\b/g, '');
  title = title.replace(/\s{2,}/g, ' ');
  return normalizeSpaces(title);
}

function convertShorthand(value = '') {
  let title = String(value || '');
  title = title.replace(/\b(US|USA)\s+PRES\b/ig, 'US President');
  title = title.replace(/\bGDP\b/g, 'GDP');
  title = title.replace(/\bCPI\b/g, 'CPI');
  title = title.replace(/\bFOMC\b/g, 'FOMC');
  title = title.replace(/\bUNEMP\b/ig, 'Unemployment');
  title = title.replace(/\bQ([1-4])\b/ig, 'Q$1');
  return normalizeSpaces(title);
}

function trimWithEllipsis(value = '', maxLen = MAX_TITLE_LEN) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

function computeQualityScore(title = '') {
  let score = 0.35;
  const value = String(title || '');
  if (value.length >= 14) score += 0.15;
  if (value.length <= MAX_TITLE_LEN) score += 0.1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 0.15;
  if (!/[|_]/.test(value)) score += 0.1;
  if (!/\b[A-Z]{5,}\b/.test(value)) score += 0.08;
  if (/\b(will|be|in|by|on|to|at|for)\b/i.test(value)) score += 0.07;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function chooseRawTitle(rawMarket = {}) {
  return normalizeSpaces(
    rawMarket.displayTitle ||
    rawMarket.display_title ||
    rawMarket.title ||
    rawMarket.subtitle ||
    rawMarket.event_title ||
    rawMarket.eventTitle ||
    rawMarket.name ||
    rawMarket.ticker ||
    ''
  );
}

function chooseRawSubtitle(rawMarket = {}) {
  return normalizeSpaces(
    rawMarket.displaySubtitle ||
    rawMarket.display_subtitle ||
    rawMarket.subtitle ||
    rawMarket.event_title ||
    rawMarket.series_ticker ||
    rawMarket.category ||
    ''
  );
}

export function buildRuleBasedDisplayTitle(rawMarket = {}) {
  const ticker = normalizeSpaces(rawMarket.ticker || '');
  const rawTitle = chooseRawTitle(rawMarket);
  const rawSubtitle = chooseRawSubtitle(rawMarket);

  let cleanedTitle = convertShorthand(cleanTokenNoise(rawTitle));
  if (!cleanedTitle) cleanedTitle = ticker || 'Prediction Market';
  if (!/[a-z]/.test(cleanedTitle) && /[A-Z]/.test(cleanedTitle)) {
    cleanedTitle = toTitleCase(cleanedTitle);
  }
  cleanedTitle = trimWithEllipsis(cleanedTitle, MAX_TITLE_LEN);

  const subtitleSource = rawSubtitle && rawSubtitle.toLowerCase() !== cleanedTitle.toLowerCase()
    ? rawSubtitle
    : (rawMarket.category || '');
  const cleanedSubtitle = trimWithEllipsis(convertShorthand(cleanTokenNoise(subtitleSource)), MAX_SUBTITLE_LEN);

  return {
    displayTitle: cleanedTitle || ticker || 'Prediction Market',
    displaySubtitle: cleanedSubtitle || '',
    titleSource: 'rules',
    qualityScore: computeQualityScore(cleanedTitle),
  };
}

function aiEnabled() {
  return String(process.env.MARKETS_TITLE_AI_ENABLED || '0').trim() === '1';
}

function getRefreshMs() {
  return Number.parseInt(process.env.MARKETS_TITLE_REFRESH_MS || `${DEFAULT_REFRESH_MS}`, 10) || DEFAULT_REFRESH_MS;
}

function getOllamaConfig() {
  return {
    baseUrl: String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, ''),
    model: String(process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim(),
    timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || `${DEFAULT_OLLAMA_TIMEOUT_MS}`, 10) || DEFAULT_OLLAMA_TIMEOUT_MS,
  };
}

function parseAiResponse(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function fetchOllamaTitle(rawMarket, rulesResult) {
  if (!aiEnabled()) return null;
  if (ollamaState.cooldownUntil > now()) return null;

  const cfg = getOllamaConfig();
  if (!cfg.model) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  const prompt = [
    'Rewrite this prediction market title for readability.',
    'Do not invent details.',
    'Return JSON only: {"title":"...","subtitle":"..."}',
    `Ticker: ${rawMarket.ticker || ''}`,
    `Category: ${rawMarket.category || ''}`,
    `Raw title: ${rawMarket.title || ''}`,
    `Raw subtitle: ${rawMarket.subtitle || rawMarket.event_title || ''}`,
    `Rule title: ${rulesResult.displayTitle}`,
    `Rule subtitle: ${rulesResult.displaySubtitle || ''}`,
  ].join('\n');

  try {
    const res = await fetch(`${cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 120,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`ollama status ${res.status}`);
    }
    const payload = await res.json();
    const parsed = parseAiResponse(payload?.response || '');
    if (!parsed || typeof parsed !== 'object') return null;
    const aiTitle = trimWithEllipsis(normalizeSpaces(parsed.title || ''), MAX_TITLE_LEN);
    const aiSubtitle = trimWithEllipsis(normalizeSpaces(parsed.subtitle || ''), MAX_SUBTITLE_LEN);
    if (!aiTitle) return null;
    return {
      displayTitle: aiTitle,
      displaySubtitle: aiSubtitle,
      titleSource: 'ollama',
      qualityScore: Math.max(rulesResult.qualityScore, computeQualityScore(aiTitle)),
    };
  } catch (err) {
    clearTimeout(timer);
    ollamaState.lastError = err?.message || 'unknown';
    ollamaState.cooldownUntil = now() + OLLAMA_COOLDOWN_MS;
    return null;
  }
}

export async function getDisplayTitle(rawMarket = {}, { allowAi = true } = {}) {
  const rules = buildRuleBasedDisplayTitle(rawMarket);
  if (!allowAi) return rules;
  if (rules.qualityScore >= AI_MIN_QUALITY_SCORE) return rules;

  const ai = await fetchOllamaTitle(rawMarket, rules);
  return ai || rules;
}

export function getTitleEngineStatus() {
  const cfg = getOllamaConfig();
  const mode = aiEnabled() ? 'rules+ollama' : 'rules-only';
  return {
    mode,
    aiEnabled: aiEnabled(),
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    healthy: !aiEnabled() || ollamaState.cooldownUntil <= now(),
    cooldownUntil: ollamaState.cooldownUntil,
    lastError: ollamaState.lastError,
  };
}

export function shouldRefreshDisplayTitle(row = {}, timestamp = Date.now()) {
  const refreshMs = getRefreshMs();
  const titleUpdatedAt = Number(row.title_updated_at || row.titleUpdatedAt || 0);
  if (!row.display_title && !row.displayTitle) return true;
  if (!titleUpdatedAt) return true;
  return (timestamp - titleUpdatedAt) >= refreshMs;
}

export function attachDisplayTitle(row = {}) {
  const existingTitle = normalizeSpaces(row.display_title || row.displayTitle || '');
  if (existingTitle) {
    return {
      displayTitle: existingTitle,
      displaySubtitle: normalizeSpaces(row.display_subtitle || row.displaySubtitle || ''),
      titleSource: normalizeSpaces(row.title_source || row.titleSource || 'rules') || 'rules',
      qualityScore: Number.isFinite(Number(row.title_quality_score))
        ? Number(row.title_quality_score)
        : computeQualityScore(existingTitle),
    };
  }
  return buildRuleBasedDisplayTitle(row);
}

