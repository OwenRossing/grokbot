import {
  getCachedMarket,
  getUserSeasonStats,
  getUserTotals,
  listUserPositions,
  upsertUserSeasonStats,
  upsertUserTotals,
  getUserWallet,
} from './store.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function estimatePositionValue(position, market) {
  if (!position || !market) return 0;
  const qty = toNumber(position.qty);
  if (qty <= 0) return 0;
  const side = String(position.side || '').toLowerCase();
  const price = side === 'yes' ? toNumber(market.yes_price ?? market.yesPrice) : toNumber(market.no_price ?? market.noPrice);
  return (qty * price) / 100;
}

export function computeNetWorth({ cashBalance, positions = [], marketByTicker = new Map() }) {
  let total = toNumber(cashBalance);
  for (const position of positions) {
    const market = marketByTicker.get(position.ticker);
    total += estimatePositionValue(position, market);
  }
  return total;
}

export function refreshUserNetWorth(userId, seasonId) {
  const wallet = getUserWallet(userId, seasonId);
  if (!wallet) return null;

  const positions = listUserPositions(userId, seasonId);
  const marketByTicker = new Map();
  for (const pos of positions) {
    if (!marketByTicker.has(pos.ticker)) {
      marketByTicker.set(pos.ticker, getCachedMarket(pos.ticker));
    }
  }

  const netWorth = computeNetWorth({
    cashBalance: wallet.cash_balance,
    positions,
    marketByTicker,
  });

  const current = getUserSeasonStats(userId, seasonId) || {
    trades: 0,
    wins: 0,
    losses: 0,
    realized_pnl: 0,
  };

  upsertUserSeasonStats({
    userId,
    seasonId,
    trades: toNumber(current.trades),
    wins: toNumber(current.wins),
    losses: toNumber(current.losses),
    realizedPnl: toNumber(current.realized_pnl),
    netWorth,
  });

  return {
    userId,
    seasonId,
    netWorth,
    cashBalance: toNumber(wallet.cash_balance),
  };
}

export function incrementTradeCount(userId, seasonId, delta = 1) {
  const current = getUserSeasonStats(userId, seasonId) || {
    trades: 0,
    wins: 0,
    losses: 0,
    realized_pnl: 0,
    net_worth: 0,
  };
  const totals = getUserTotals(userId) || {
    trades: 0,
    wins: 0,
    losses: 0,
    realized_pnl: 0,
  };

  upsertUserSeasonStats({
    userId,
    seasonId,
    trades: toNumber(current.trades) + delta,
    wins: toNumber(current.wins),
    losses: toNumber(current.losses),
    realizedPnl: toNumber(current.realized_pnl),
    netWorth: toNumber(current.net_worth),
  });

  upsertUserTotals({
    userId,
    trades: toNumber(totals.trades) + delta,
    wins: toNumber(totals.wins),
    losses: toNumber(totals.losses),
    realizedPnl: toNumber(totals.realized_pnl),
  });
}

export function applySettlementStats({ userId, seasonId, pnl }) {
  const delta = toNumber(pnl);
  const win = delta > 0 ? 1 : 0;
  const loss = delta <= 0 ? 1 : 0;

  const current = getUserSeasonStats(userId, seasonId) || {
    trades: 0,
    wins: 0,
    losses: 0,
    realized_pnl: 0,
    net_worth: 0,
  };
  const totals = getUserTotals(userId) || {
    trades: 0,
    wins: 0,
    losses: 0,
    realized_pnl: 0,
  };

  upsertUserSeasonStats({
    userId,
    seasonId,
    trades: toNumber(current.trades),
    wins: toNumber(current.wins) + win,
    losses: toNumber(current.losses) + loss,
    realizedPnl: toNumber(current.realized_pnl) + delta,
    netWorth: toNumber(current.net_worth),
  });

  upsertUserTotals({
    userId,
    trades: toNumber(totals.trades),
    wins: toNumber(totals.wins) + win,
    losses: toNumber(totals.losses) + loss,
    realizedPnl: toNumber(totals.realized_pnl) + delta,
  });
}
