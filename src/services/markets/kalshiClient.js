const DEFAULT_BASE_URL = 'https://api.elections.kalshi.com';
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_TTL_MS = 45_000;

const requestCache = new Map();

function now() {
  return Date.now();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePrice(raw) {
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  if (n >= 0 && n <= 100) return Math.round(n);
  if (n > 100 && n <= 10_000) return Math.round(n / 100);
  return null;
}

function choosePrice(...candidates) {
  for (const candidate of candidates) {
    const p = normalizePrice(candidate);
    if (Number.isFinite(p)) return Math.max(1, Math.min(99, p));
  }
  return null;
}

function normalizeMarket(raw = {}) {
  const yesPrice = choosePrice(
    raw.yes_price,
    raw.yesPrice,
    raw.last_price,
    raw.lastPrice,
    raw.yes_bid,
    raw.yesBid,
    raw.yes_ask,
    raw.yesAsk
  );
  const explicitNo = choosePrice(raw.no_price, raw.noPrice, raw.no_bid, raw.noBid, raw.no_ask, raw.noAsk);
  const noPrice = Number.isFinite(explicitNo) ? explicitNo : (Number.isFinite(yesPrice) ? 100 - yesPrice : null);

  return {
    ticker: String(raw.ticker || raw.market_ticker || '').trim(),
    title: String(raw.title || raw.subtitle || raw.event_title || raw.eventTitle || raw.name || '').trim(),
    category: String(raw.category || raw.series_ticker || raw.seriesTicker || raw.event_category || 'general').trim(),
    closeTime: Number.isFinite(Number(raw.close_time))
      ? Number(raw.close_time)
      : Date.parse(raw.close_time || raw.closeTime || raw.expiration_time || raw.expirationTime || '') || 0,
    status: String(raw.status || raw.market_status || raw.state || '').trim().toLowerCase() || 'open',
    yesPrice,
    noPrice,
    sourceUpdatedAt: Date.parse(raw.updated_at || raw.updatedAt || raw.last_updated || raw.lastUpdated || '') || now(),
    raw,
  };
}

function getCacheKey(path, params) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

async function fetchJson(path, params = {}, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const baseUrl = String(process.env.KALSHI_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const token = String(process.env.KALSHI_API_KEY || '').trim();
  const timeoutMs = Number.parseInt(process.env.KALSHI_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10) || DEFAULT_TIMEOUT_MS;

  const key = getCacheKey(path, params);
  const cached = requestCache.get(key);
  if (cached && cached.expiresAt > now()) {
    return cached.value;
  }

  const url = new URL(`${baseUrl}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let attempt = 0;
  let lastError = null;
  while (attempt < 3) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        const backoffMs = 250 * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      if (!res.ok) {
        throw new Error(`kalshi request failed (${res.status})`);
      }
      const json = await res.json();
      requestCache.set(key, { value: json, expiresAt: now() + ttlMs });
      return json;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      const backoffMs = 250 * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error('kalshi request failed');
}

export async function listMarkets({ category = '', status = 'open', limit = 10 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const payload = await fetchJson('/trade-api/v2/markets', {
    status: status === 'all' ? undefined : status,
    limit: size,
    category: category || undefined,
  });
  const rows = Array.isArray(payload?.markets)
    ? payload.markets
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const normalized = rows.map((row) => normalizeMarket(row)).filter((row) => row.ticker);
  if (!category) return normalized.slice(0, size);
  const lowerCategory = String(category).toLowerCase();
  return normalized.filter((row) => row.category.toLowerCase().includes(lowerCategory)).slice(0, size);
}

export async function getMarketByTicker(ticker) {
  const key = String(ticker || '').trim();
  if (!key) throw new Error('ticker is required');

  const payload = await fetchJson(`/trade-api/v2/markets/${encodeURIComponent(key)}`);
  const raw = payload?.market || payload?.data || payload;
  const normalized = normalizeMarket(raw);
  if (!normalized.ticker) {
    throw new Error(`market not found for ticker ${key}`);
  }
  return normalized;
}

export async function getMarketSnapshot(ticker) {
  const market = await getMarketByTicker(ticker);
  return {
    ticker: market.ticker,
    status: market.status,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    closeTime: market.closeTime,
    sourceUpdatedAt: market.sourceUpdatedAt,
    raw: market.raw,
  };
}
