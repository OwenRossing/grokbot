import { getCardsBySet, upsertCard, upsertSet } from './tcgStore.js';

const API_BASE = process.env.POKEMONTCG_API_BASE_URL || 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMONTCG_API_KEY || '';

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  return headers;
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`pokemon api ${response.status}: ${text.slice(0, 200)}`);
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

export async function syncSetFromApi(setCode) {
  const existing = getCardsBySet(setCode);
  if (existing.length >= 20) return;

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
}
