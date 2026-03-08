import { listNetWorthLeaderboard } from './store.js';

export function sortLeaderboardRows(rows = []) {
  return [...rows].sort((a, b) => {
    const netWorthDiff = Number(b.net_worth || 0) - Number(a.net_worth || 0);
    if (netWorthDiff !== 0) return netWorthDiff;

    const realizedDiff = Number(b.realized_pnl || 0) - Number(a.realized_pnl || 0);
    if (realizedDiff !== 0) return realizedDiff;

    return Number(a.updated_at || 0) - Number(b.updated_at || 0);
  });
}

export function getNetWorthLeaderboard(seasonId, limit = 10) {
  const rows = listNetWorthLeaderboard(seasonId, limit);
  return sortLeaderboardRows(rows).slice(0, Math.max(1, Math.min(Number(limit) || 10, 25)));
}
