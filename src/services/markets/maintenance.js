import { getMarketByTicker, listMarkets } from './kalshiClient.js';
import { settleMarketIfResolved } from './paperEngine.js';
import {
  ensureActiveSeason,
  listActiveTickers,
  listCachedMarkets,
  maybeRollSeason,
  upsertMarketCache,
} from './store.js';
import { refreshUserNetWorth } from './statsService.js';

function now() {
  return Date.now();
}

function coerceOutcome(rawMarket = {}) {
  const status = String(rawMarket.status || '').toLowerCase();
  const outcome = String(
    rawMarket.result ||
    rawMarket.outcome ||
    rawMarket.settlement ||
    rawMarket.winning_side ||
    ''
  ).toLowerCase();

  if (outcome.includes('yes')) return 'yes';
  if (outcome.includes('no')) return 'no';
  if (status === 'settled_yes') return 'yes';
  if (status === 'settled_no') return 'no';
  return '';
}

export async function syncMarketCache({ limit = 25 } = {}) {
  const markets = await listMarkets({ status: 'all', limit });
  for (const market of markets) {
    upsertMarketCache(market);
  }
  return markets.length;
}

export async function settleResolvedMarkets() {
  const season = ensureActiveSeason(now());
  const tickers = new Set(listActiveTickers());
  const cached = listCachedMarkets({ status: 'all', limit: 100 });
  for (const row of cached) tickers.add(row.ticker);

  let settledCount = 0;
  for (const ticker of tickers) {
    if (!ticker) continue;
    try {
      const market = await getMarketByTicker(ticker);
      upsertMarketCache(market);
      const explicitOutcome = coerceOutcome(market.raw || market);
      if (!explicitOutcome) continue;
      const settled = settleMarketIfResolved({
        seasonId: season.season_id,
        ticker,
        market: {
          ...market,
          outcome: explicitOutcome,
          status: 'settled',
        },
      });
      if (settled.settled) {
        settledCount += 1;
      }
    } catch (err) {
      // Best-effort settlement pass.
    }
  }

  return settledCount;
}

export async function runMarketsMaintenance() {
  const rollover = maybeRollSeason(now());
  const season = ensureActiveSeason(now());

  let synced = 0;
  let settled = 0;

  try {
    synced = await syncMarketCache({ limit: 40 });
  } catch (err) {
    // keep stale cache when upstream unavailable
  }

  try {
    settled = await settleResolvedMarkets();
  } catch (err) {
    // keep bot alive on settlement failures
  }

  // Refresh leaderboard candidates after cache/settlement updates.
  const rows = listCachedMarkets({ status: 'all', limit: 500 });
  const touchedUsers = new Set();
  for (const row of rows) {
    if (!row?.ticker) continue;
    // Refresh is lazy elsewhere; maintenance should not brute-force all users each run.
  }
  for (const userId of touchedUsers) {
    refreshUserNetWorth(userId, season.season_id);
  }

  return {
    seasonId: season.season_id,
    rollover,
    synced,
    settled,
  };
}
