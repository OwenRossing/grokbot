import { db } from '../../memory.js';

const API_BASE = String(process.env.POKEMONTCG_API_BASE_URL || 'https://api.pokemontcg.io/v2').replace(/\/+$/, '');
const API_KEY = String(process.env.POKEMONTCG_API_KEY || '').trim();
const PRICE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.POKEMONTCG_PRICE_TTL_MS || `${24 * 60 * 60 * 1000}`, 10) || (24 * 60 * 60 * 1000)
);
const API_TIMEOUT_MS = Number.parseInt(process.env.POKEMONTCG_API_TIMEOUT_MS || '12000', 10);

db.exec(`
  CREATE TABLE IF NOT EXISTS card_prices (
    card_id TEXT PRIMARY KEY,
    price_cents INTEGER,
    source TEXT,
    updated_at INTEGER,
    fetched_at INTEGER NOT NULL
  );
`);

const getPriceStmt = db.prepare(`
  SELECT card_id, price_cents, source, updated_at, fetched_at
  FROM card_prices
  WHERE card_id = ?
`);

const upsertPriceStmt = db.prepare(`
  INSERT INTO card_prices (card_id, price_cents, source, updated_at, fetched_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(card_id) DO UPDATE SET
    price_cents = excluded.price_cents,
    source = excluded.source,
    updated_at = excluded.updated_at,
    fetched_at = excluded.fetched_at
`);

function toMillis(ts) {
  if (!ts) return null;
  const parsed = Date.parse(String(ts));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toResultRow(row) {
  if (!row) return { dollars: null, source: null, updatedAt: null };
  return {
    dollars: Number.isFinite(Number(row.price_cents)) ? Number(row.price_cents) / 100 : null,
    source: row.source || null,
    updatedAt: Number.isFinite(Number(row.updated_at)) ? Number(row.updated_at) : null,
  };
}

function firstFinite(values = []) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extractEstimatedFromCardPayload(payload) {
  const card = payload?.data || payload || {};
  const prices = card?.tcgplayer?.prices || {};
  const updatedAt = toMillis(card?.tcgplayer?.updatedAt);

  const holoMarket = firstFinite([
    prices?.holofoil?.market,
  ]);
  if (holoMarket !== null) {
    return { dollars: holoMarket, source: 'TCGplayer', updatedAt };
  }

  const buckets = Object.values(prices || {});
  for (const bucket of buckets) {
    const candidate = firstFinite([
      bucket?.market,
      bucket?.mid,
      bucket?.low,
      bucket?.high,
    ]);
    if (candidate !== null) {
      return { dollars: candidate, source: 'TCGplayer', updatedAt };
    }
  }

  return { dollars: null, source: null, updatedAt: null };
}

async function fetchCardPayload(cardId) {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  const response = await fetch(`${API_BASE}/cards/${encodeURIComponent(cardId)}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`pokemon pricing api ${response.status}: ${body.slice(0, 180)}`);
  }
  return response.json();
}

export async function getCardEstimatedPrice(cardId) {
  const safeCardId = String(cardId || '').trim();
  if (!safeCardId) return { dollars: null, source: null, updatedAt: null };

  const now = Date.now();
  const cached = getPriceStmt.get(safeCardId);
  if (cached && (now - Number(cached.fetched_at || 0)) < PRICE_TTL_MS) {
    return toResultRow(cached);
  }

  try {
    const payload = await fetchCardPayload(safeCardId);
    const parsed = extractEstimatedFromCardPayload(payload);
    const cents = Number.isFinite(Number(parsed.dollars)) ? Math.round(Number(parsed.dollars) * 100) : null;
    const resolvedUpdatedAt = Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : now;
    upsertPriceStmt.run(
      safeCardId,
      cents,
      parsed.source || null,
      resolvedUpdatedAt,
      now
    );
    return {
      dollars: Number.isFinite(Number(parsed.dollars)) ? Number(parsed.dollars) : null,
      source: parsed.source || null,
      updatedAt: resolvedUpdatedAt,
    };
  } catch {
    if (cached) return toResultRow(cached);
    return { dollars: null, source: null, updatedAt: null };
  }
}

