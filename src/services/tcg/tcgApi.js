import { getCardsBySet, upsertCard, upsertSet } from './tcgStore.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = process.env.POKEMONTCG_API_BASE_URL || 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMONTCG_API_KEY || '';
const API_MAX_RETRIES = Number.parseInt(process.env.POKEMONTCG_API_MAX_RETRIES || '3', 10);
const API_RETRY_BASE_MS = Number.parseInt(process.env.POKEMONTCG_API_RETRY_BASE_MS || '600', 10);
const API_TIMEOUT_MS = Number.parseInt(process.env.POKEMONTCG_API_TIMEOUT_MS || '12000', 10);
const DATA_REPO_BASE =
  process.env.POKEMONTCG_DATA_REPO_BASE_URL ||
  'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const DATA_REPO_FALLBACK_ENABLED = process.env.POKEMONTCG_DATA_REPO_FALLBACK !== '0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_PREVIEW_CONFIG_PATH = path.join(__dirname, '../../../config/tcg-pack-previews.json');

function loadPackPreviewMap() {
  try {
    if (!fs.existsSync(PACK_PREVIEW_CONFIG_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(PACK_PREVIEW_CONFIG_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

const PACK_PREVIEW_MAP = loadPackPreviewMap();

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  return headers;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function briefErrorText(text = '') {
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) return 'upstream html error page';
  return trimmed.slice(0, 180);
}

async function fetchJson(path) {
  const url = `${API_BASE}${path}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= Math.max(1, API_MAX_RETRIES); attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`pokemon api ${response.status}: ${briefErrorText(text)}`);
        err.status = response.status;
        if (isRetryableStatus(response.status) && attempt < API_MAX_RETRIES) {
          await delay(API_RETRY_BASE_MS * attempt);
          continue;
        }
        throw err;
      }
      return response.json();
    } catch (err) {
      lastErr = err;
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if ((isTimeout || isRetryableStatus(Number(err?.status || 0))) && attempt < API_MAX_RETRIES) {
        await delay(API_RETRY_BASE_MS * attempt);
        continue;
      }
      break;
    }
  }
  if (lastErr?.name === 'TimeoutError' || lastErr?.name === 'AbortError') {
    throw new Error('pokemon api timeout');
  }
  throw lastErr || new Error('pokemon api request failed');
}

async function fetchDataRepoJson(path) {
  const response = await fetch(`${DATA_REPO_BASE}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`pokemon data repo ${response.status}: ${briefErrorText(text)}`);
  }
  return response.json();
}

function normalizeCard(raw) {
  const market =
    raw?.cardmarket?.prices?.averageSellPrice ??
    raw?.tcgplayer?.prices?.holofoil?.market ??
    raw?.tcgplayer?.prices?.normal?.market ??
    null;
  return {
    cardId: raw.id,
    setCode: raw.set?.id || '',
    name: raw.name || '',
    rarity: raw.rarity || '',
    supertype: raw.supertype || '',
    imageSmall: raw.images?.small || '',
    imageLarge: raw.images?.large || '',
    marketPriceUsd: Number.isFinite(Number(market)) ? Number(market) : null,
  };
}

function normalizeRepoCard(raw, setCode) {
  const market =
    raw?.cardmarket?.prices?.averageSellPrice ??
    raw?.tcgplayer?.prices?.holofoil?.market ??
    raw?.tcgplayer?.prices?.normal?.market ??
    null;
  return {
    cardId: raw.id,
    setCode,
    name: raw.name || '',
    rarity: raw.rarity || '',
    supertype: raw.supertype || '',
    imageSmall: raw.images?.small || '',
    imageLarge: raw.images?.large || '',
    marketPriceUsd: Number.isFinite(Number(market)) ? Number(market) : null,
  };
}

function resolveSetPreview(setCode, setData) {
  const normalized = String(setCode || '').trim().toLowerCase();
  const custom = PACK_PREVIEW_MAP[normalized] || PACK_PREVIEW_MAP[setCode] || '';
  if (custom) return custom;
  return setData?.images?.logo || setData?.images?.symbol || '';
}

async function syncSetFromDataRepo(setCode) {
  const sets = await fetchDataRepoJson('/sets/en.json');
  const setData = Array.isArray(sets)
    ? sets.find((setRow) => String(setRow?.id || '').toLowerCase() === String(setCode || '').toLowerCase())
    : null;
  if (!setData?.id) {
    throw new Error(`set not found: ${setCode}`);
  }

  upsertSet({
    setCode: setData.id,
    name: setData.name || setData.id,
    releaseDate: setData.releaseDate || '',
    packProfileJson: '',
    logoImageUrl: setData?.images?.logo || '',
    symbolImageUrl: setData?.images?.symbol || '',
    packPreviewImageUrl: resolveSetPreview(setData.id, setData),
  });

  const cards = await fetchDataRepoJson(`/cards/en/${encodeURIComponent(setData.id)}.json`);
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`set has no cards: ${setData.id}`);
  }
  for (const row of cards) {
    const card = normalizeRepoCard(row, setData.id);
    if (card.cardId) upsertCard(card);
  }
}

export async function syncSetFromApi(setCode) {
  const existing = getCardsBySet(setCode);
  if (existing.length >= 20) return;

  try {
    const setRes = await fetchJson(`/sets/${encodeURIComponent(setCode)}`);
    const setData = setRes?.data;
    if (!setData?.id) {
      throw new Error(`set not found: ${setCode}`);
    }
    upsertSet({
      setCode: setData.id,
      name: setData.name || setData.id,
      releaseDate: setData.releaseDate || '',
      packProfileJson: '',
      logoImageUrl: setData?.images?.logo || '',
      symbolImageUrl: setData?.images?.symbol || '',
      packPreviewImageUrl: resolveSetPreview(setData.id, setData),
    });

    let page = 1;
    const pageSize = 250;
    while (true) {
      const cardsRes = await fetchJson(
        `/cards?q=set.id:${encodeURIComponent(setCode)}&page=${page}&pageSize=${pageSize}`
      );
      const rows = Array.isArray(cardsRes?.data) ? cardsRes.data : [];
      for (const row of rows) {
        const card = normalizeCard(row);
        if (card.cardId && card.setCode) upsertCard(card);
      }
      const totalCount = Number(cardsRes?.totalCount || rows.length);
      const seen = page * pageSize;
      if (seen >= totalCount || rows.length === 0) break;
      page += 1;
    }
  } catch (err) {
    if (!DATA_REPO_FALLBACK_ENABLED) throw err;
    console.warn(`Pokemon API sync failed for ${setCode}; falling back to pokemon-tcg-data repo:`, err?.message || err);
    await syncSetFromDataRepo(setCode);
  }
}
