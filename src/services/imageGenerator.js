import { setTimeout as delay } from 'node:timers/promises';

const IMAGE_MODEL = process.env.GROK_IMAGE_MODEL || process.env.GROK_MODEL || 'grok-imagine-image';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.IMAGE_GEN_TIMEOUT_MS || '45000', 10);
const MAX_GLOBAL_CONCURRENCY = Number.parseInt(process.env.IMAGE_GEN_MAX_CONCURRENCY || '4', 10);
const MAX_USER_CONCURRENCY = 1;
const BREAKER_FAILURE_THRESHOLD = Number.parseInt(process.env.IMAGE_GEN_BREAKER_THRESHOLD || '5', 10);
const BREAKER_OPEN_MS = Number.parseInt(process.env.IMAGE_GEN_BREAKER_OPEN_MS || '30000', 10);

let activeGlobal = 0;
const globalQueue = [];
const userActive = new Map();
const userQueue = new Map();
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  let url = baseUrl.replace(/\/+$/, '');
  while (url.endsWith('/v1')) {
    url = url.slice(0, -3);
  }
  return url;
}

async function withGlobalSlot(fn) {
  if (activeGlobal >= MAX_GLOBAL_CONCURRENCY) {
    await new Promise((resolve) => globalQueue.push(resolve));
  }
  activeGlobal += 1;
  try {
    return await fn();
  } finally {
    activeGlobal -= 1;
    const next = globalQueue.shift();
    if (next) next();
  }
}

async function withUserSlot(userId, fn) {
  const current = userActive.get(userId) || 0;
  if (current >= MAX_USER_CONCURRENCY) {
    await new Promise((resolve) => {
      const queue = userQueue.get(userId) || [];
      queue.push(resolve);
      userQueue.set(userId, queue);
    });
  }
  userActive.set(userId, (userActive.get(userId) || 0) + 1);
  try {
    return await fn();
  } finally {
    const nextCount = Math.max(0, (userActive.get(userId) || 1) - 1);
    if (nextCount === 0) userActive.delete(userId);
    else userActive.set(userId, nextCount);
    const queue = userQueue.get(userId) || [];
    const next = queue.shift();
    if (queue.length) userQueue.set(userId, queue);
    else userQueue.delete(userId);
    if (next) next();
  }
}

function onSuccess() {
  consecutiveFailures = 0;
}

function onFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
  }
}

function maybeTripCircuit() {
  if (Date.now() < breakerOpenUntil) {
    const err = new Error('Image generation temporarily unavailable. Please try again shortly.');
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseImageResponse(data) {
  const first = data?.data?.[0] || {};
  const providerRequestId = data?.id || data?.request_id || '';
  const revisedPrompt = first?.revised_prompt || data?.revised_prompt || '';
  if (first?.b64_json) {
    const buffer = Buffer.from(first.b64_json, 'base64');
    return { buffer, mimeType: 'image/png', providerRequestId, revisedPrompt };
  }
  if (first?.url) {
    return { url: first.url, providerRequestId, revisedPrompt };
  }
  return null;
}

async function downloadImage(url) {
  const res = await fetchWithTimeout(url, { method: 'GET' }, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`IMAGE_DOWNLOAD_FAILED:${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/png';
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType.split(';')[0],
  };
}

async function callProvider({ prompt, size, style }) {
  const baseUrl = normalizeBaseUrl(process.env.GROK_BASE_URL);
  const body = {
    model: IMAGE_MODEL,
    prompt,
    size,
    n: 1,
    response_format: 'b64_json',
  };
  if (style) body.style = style;

  const response = await fetchWithTimeout(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`IMAGE_PROVIDER_ERROR:${response.status}:${text}`);
    err.httpStatus = response.status;
    err.providerBody = text;
    throw err;
  }

  const data = await response.json();
  const parsed = parseImageResponse(data);
  if (!parsed) {
    throw new Error('IMAGE_PROVIDER_EMPTY');
  }
  if (parsed.url && !parsed.buffer) {
    const downloaded = await downloadImage(parsed.url);
    return {
      ...downloaded,
      providerRequestId: parsed.providerRequestId,
      revisedPrompt: parsed.revisedPrompt,
    };
  }
  return parsed;
}

export async function generateImage({ prompt, size = '1024x1024', style = '' , userId }) {
  maybeTripCircuit();
  const start = Date.now();

  const execute = async () => {
    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      attempts += 1;
      try {
        const result = await callProvider({ prompt, size, style });
        onSuccess();
        return {
          ...result,
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        lastErr = err;
        const status = err?.httpStatus || 0;
        const retryable = status === 429 || status >= 500 || err?.name === 'AbortError';
        if (!retryable || attempts >= 2) break;
        await delay(500 * attempts);
      }
    }
    onFailure();
    if (lastErr?.name === 'AbortError') {
      const timeoutErr = new Error('Image generation timed out. Please try again.');
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    }
    if (lastErr?.httpStatus === 429) {
      const limitErr = new Error('Image provider is rate-limited right now. Try again in a minute.');
      limitErr.code = 'PROVIDER_RATE_LIMIT';
      throw limitErr;
    }
    if (lastErr?.httpStatus === 400) {
      const body = String(lastErr?.providerBody || '');
      const invalidModel =
        /model|unknown|unsupported|not found|invalid/i.test(body) ||
        /grok[-_a-z0-9]+/i.test(body);
      const badReqErr = new Error(
        invalidModel
          ? `Image provider rejected the model. Set GROK_IMAGE_MODEL to a valid image model (for example: grok-imagine-image).`
          : 'Image provider rejected the request. Check prompt/size/style parameters.'
      );
      badReqErr.code = invalidModel ? 'INVALID_IMAGE_MODEL' : 'BAD_IMAGE_REQUEST';
      throw badReqErr;
    }
    if (lastErr?.httpStatus === 401 || lastErr?.httpStatus === 403) {
      const authErr = new Error('Image provider authentication failed. Verify GROK_API_KEY permissions.');
      authErr.code = 'PROVIDER_AUTH';
      throw authErr;
    }
    const genericErr = new Error('Image generation failed due to provider error.');
    genericErr.code = 'PROVIDER_ERROR';
    throw genericErr;
  };

  return withGlobalSlot(() => withUserSlot(userId, execute));
}
