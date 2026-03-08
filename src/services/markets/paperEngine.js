import {
  ensureActiveSeason,
  ensureUserWallet,
  getCachedMarket,
  getPosition,
  listPositionsForMarket,
  setUserCashBalance,
  upsertPosition,
  writeTradeTransaction,
  getResolution,
  upsertResolution,
  clearPositionsForMarket,
} from './store.js';
import { evaluateAchievementUnlocks } from './achievementService.js';
import {
  applySettlementStats,
  incrementTradeCount,
  refreshUserNetWorth,
} from './statsService.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function calculateWeightedAveragePrice(currentQty, currentAvgPrice, addQty, addPrice) {
  const existingQty = toNumber(currentQty);
  const existingAvg = toNumber(currentAvgPrice);
  const nextQty = toNumber(addQty);
  const nextPrice = toNumber(addPrice);

  if (existingQty <= 0) return nextPrice;
  const totalCost = (existingQty * existingAvg) + (nextQty * nextPrice);
  return totalCost / (existingQty + nextQty);
}

function validateBuyMarketState(market) {
  if (!market) throw new Error('market not found in cache');
  const status = String(market.status || '').toLowerCase();
  if (['settled', 'closed', 'finalized', 'resolved'].includes(status)) {
    throw new Error('market is not open');
  }
  if (Number(market.close_time) > 0 && Date.now() >= Number(market.close_time)) {
    throw new Error('market already closed');
  }
}

export function settlePosition({ qty, avgPrice, side, winningSide }) {
  const contracts = toNumber(qty);
  if (contracts <= 0) return { payout: 0, pnl: 0 };
  const entry = toNumber(avgPrice);
  const cost = (contracts * entry) / 100;
  const win = String(side || '').toLowerCase() === String(winningSide || '').toLowerCase();
  if (!win) {
    return { payout: 0, pnl: -cost };
  }
  const payout = contracts;
  const pnl = payout - cost;
  return { payout, pnl };
}

export function placeBuyOrder({ userId, ticker, side, qty }) {
  const safeUserId = String(userId || '').trim();
  const safeTicker = String(ticker || '').trim();
  const safeSide = String(side || '').toLowerCase();
  const safeQty = Number.parseInt(`${qty}`, 10);

  if (!safeUserId) throw new Error('user is required');
  if (!safeTicker) throw new Error('ticker is required');
  if (!['yes', 'no'].includes(safeSide)) throw new Error('side must be yes or no');
  if (!Number.isFinite(safeQty) || safeQty <= 0) throw new Error('qty must be positive');

  const season = ensureActiveSeason(Date.now());
  const wallet = ensureUserWallet(safeUserId, season.season_id);
  const market = getCachedMarket(safeTicker);
  validateBuyMarketState(market);

  const fillPrice = safeSide === 'yes' ? toNumber(market.yes_price) : toNumber(market.no_price);
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    throw new Error('market price unavailable');
  }

  const notional = (safeQty * fillPrice) / 100;
  const cash = toNumber(wallet.cash_balance);
  if (notional > cash) {
    throw new Error('insufficient balance');
  }

  const existing = getPosition(safeUserId, season.season_id, safeTicker, safeSide) || { qty: 0, avg_price: 0 };
  const nextQty = toNumber(existing.qty) + safeQty;
  const nextAvgPrice = calculateWeightedAveragePrice(existing.qty, existing.avg_price, safeQty, fillPrice);
  const newCash = cash - notional;

  const tx = writeTradeTransaction({
    userId: safeUserId,
    seasonId: season.season_id,
    ticker: safeTicker,
    side: safeSide,
    qty: safeQty,
    fillPrice,
    notional,
    newCash,
    newPositionQty: nextQty,
    newAvgPrice: nextAvgPrice,
  });

  incrementTradeCount(safeUserId, season.season_id, 1);
  const stats = refreshUserNetWorth(safeUserId, season.season_id);
  const unlocked = evaluateAchievementUnlocks({ userId: safeUserId, seasonId: season.season_id });

  return {
    orderId: tx.orderId,
    seasonId: season.season_id,
    ticker: safeTicker,
    side: safeSide,
    qty: safeQty,
    fillPrice,
    notional,
    cashAfter: newCash,
    netWorth: stats?.netWorth ?? newCash,
    achievements: unlocked,
  };
}

function deriveWinningSideFromMarket(market) {
  const winner = String(
    market?.result ||
    market?.outcome ||
    market?.settlement ||
    market?.winning_side ||
    market?.resolved_outcome ||
    ''
  ).toLowerCase();

  if (winner.includes('yes')) return 'yes';
  if (winner.includes('no')) return 'no';

  const status = String(market?.status || '').toLowerCase();
  if (!['settled', 'resolved', 'finalized'].includes(status)) return '';
  return '';
}

export function settleMarketIfResolved({ seasonId, ticker, market }) {
  const winningSide = deriveWinningSideFromMarket(market);
  if (!winningSide) return { settled: false, reason: 'not_resolved' };

  const already = getResolution(ticker);
  if (already?.resolved_outcome) {
    return { settled: false, reason: 'already_resolved', winningSide: already.resolved_outcome };
  }

  const positions = listPositionsForMarket(ticker, seasonId);
  let totalSettledPositions = 0;
  for (const pos of positions) {
    const result = settlePosition({
      qty: pos.qty,
      avgPrice: pos.avg_price,
      side: pos.side,
      winningSide,
    });

    const wallet = ensureUserWallet(pos.user_id, seasonId);
    const newCash = toNumber(wallet.cash_balance) + result.payout;
    setUserCashBalance(pos.user_id, seasonId, newCash);
    applySettlementStats({ userId: pos.user_id, seasonId, pnl: result.pnl });
    refreshUserNetWorth(pos.user_id, seasonId);
    evaluateAchievementUnlocks({ userId: pos.user_id, seasonId });
    totalSettledPositions += 1;
  }

  clearPositionsForMarket(ticker, seasonId);
  upsertResolution(ticker, winningSide);
  return {
    settled: true,
    winningSide,
    settledPositions: totalSettledPositions,
  };
}

export function upsertManualPosition({ userId, seasonId, ticker, side, qty, avgPrice }) {
  upsertPosition({ userId, seasonId, ticker, side, qty, avgPrice });
}
