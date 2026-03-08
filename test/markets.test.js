import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/memory.js';
import {
  ensureActiveSeason,
  ensureUserWallet,
  getUserWallet,
  listUserPositions,
  listNetWorthLeaderboard,
  maybeRollSeason,
  seasonWindowFromTs,
  STARTING_BALANCE,
  upsertMarketCache,
  upsertUserSeasonStats,
} from '../src/services/markets/store.js';
import { evaluateAchievementUnlocks } from '../src/services/markets/achievementService.js';
import { sortLeaderboardRows } from '../src/services/markets/leaderboardService.js';
import { calculateWeightedAveragePrice, placeBuyOrder, settlePosition } from '../src/services/markets/paperEngine.js';

function unique(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupUser(userId) {
  db.prepare('DELETE FROM pm_user_achievements WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pm_user_totals WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pm_user_stats WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pm_orders WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pm_positions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pm_users WHERE user_id = ?').run(userId);
}

test('paper buy updates cash and position; weighted average works', () => {
  const season = ensureActiveSeason(Date.now());
  const userId = unique('t_user');
  const ticker = unique('TICK').toUpperCase();
  cleanupUser(userId);

  upsertMarketCache({
    ticker,
    title: 'Test Market',
    category: 'test',
    closeTime: Date.now() + 86400000,
    yesPrice: 40,
    noPrice: 60,
    status: 'open',
    sourceUpdatedAt: Date.now(),
  });

  ensureUserWallet(userId, season.season_id);

  const first = placeBuyOrder({ userId, ticker, side: 'yes', qty: 5 });
  const afterFirstWallet = getUserWallet(userId, season.season_id);
  assert.equal(first.qty, 5);
  assert.ok(Math.abs(afterFirstWallet.cash_balance - (STARTING_BALANCE - 2.0)) < 0.0001);

  upsertMarketCache({
    ticker,
    title: 'Test Market',
    category: 'test',
    closeTime: Date.now() + 86400000,
    yesPrice: 50,
    noPrice: 50,
    status: 'open',
    sourceUpdatedAt: Date.now(),
  });
  placeBuyOrder({ userId, ticker, side: 'yes', qty: 5 });

  const positions = listUserPositions(userId, season.season_id).filter((p) => p.ticker === ticker && p.side === 'yes');
  assert.equal(positions.length, 1);
  assert.equal(positions[0].qty, 10);
  assert.equal(Number(positions[0].avg_price), 45);

  const computed = calculateWeightedAveragePrice(5, 40, 5, 50);
  assert.equal(computed, 45);

  cleanupUser(userId);
  db.prepare('DELETE FROM pm_markets_cache WHERE ticker = ?').run(ticker);
});

test('settlement payout math', () => {
  const win = settlePosition({ qty: 10, avgPrice: 35, side: 'yes', winningSide: 'yes' });
  assert.ok(Math.abs(win.payout - 10) < 0.0001);
  assert.ok(Math.abs(win.pnl - 6.5) < 0.0001);

  const loss = settlePosition({ qty: 10, avgPrice: 35, side: 'yes', winningSide: 'no' });
  assert.equal(loss.payout, 0);
  assert.ok(Math.abs(loss.pnl + 3.5) < 0.0001);
});

test('achievement unlock thresholds', () => {
  const season = ensureActiveSeason(Date.now());
  const userId = unique('a_user');
  cleanupUser(userId);

  upsertUserSeasonStats({
    userId,
    seasonId: season.season_id,
    trades: 1,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
    netWorth: STARTING_BALANCE,
  });
  let unlocked = evaluateAchievementUnlocks({ userId, seasonId: season.season_id });
  assert.ok(unlocked.some((x) => x.achievementId === 'first_trade'));

  upsertUserSeasonStats({
    userId,
    seasonId: season.season_id,
    trades: 10,
    wins: 1,
    losses: 0,
    realizedPnl: 10,
    netWorth: STARTING_BALANCE + 10,
  });
  unlocked = evaluateAchievementUnlocks({ userId, seasonId: season.season_id });
  assert.ok(unlocked.some((x) => x.achievementId === 'first_win'));
  assert.ok(unlocked.some((x) => x.achievementId === 'ten_trades'));

  cleanupUser(userId);
});

test('leaderboard ordering tie-breaks net worth then pnl then updated_at', () => {
  const rows = [
    { user_id: 'u1', net_worth: 10100, realized_pnl: 50, updated_at: 10 },
    { user_id: 'u2', net_worth: 10100, realized_pnl: 60, updated_at: 20 },
    { user_id: 'u3', net_worth: 10200, realized_pnl: 0, updated_at: 30 },
    { user_id: 'u4', net_worth: 10100, realized_pnl: 60, updated_at: 5 },
  ];
  const sorted = sortLeaderboardRows(rows);
  assert.deepEqual(sorted.map((r) => r.user_id), ['u3', 'u4', 'u2', 'u1']);
});

test('weekly rollover snapshots and resets old season data', () => {
  const current = seasonWindowFromTs(Date.now());
  const oldEndsAt = current.startsAt - 1000;
  const oldStartsAt = oldEndsAt - (7 * 24 * 60 * 60 * 1000);
  const oldSeasonId = unique('season_old');

  db.prepare("UPDATE pm_seasons SET status = 'ended' WHERE status = 'active'").run();
  db.prepare('INSERT OR REPLACE INTO pm_seasons (season_id, starts_at, ends_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(oldSeasonId, oldStartsAt, oldEndsAt, 'active', Date.now(), Date.now());

  const userId = unique('roll_user');
  cleanupUser(userId);
  db.prepare('INSERT OR REPLACE INTO pm_users (user_id, season_id, cash_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, oldSeasonId, 10500, Date.now(), Date.now());
  db.prepare('INSERT OR REPLACE INTO pm_user_stats (user_id, season_id, trades, wins, losses, realized_pnl, net_worth, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, oldSeasonId, 3, 2, 1, 250, 10750, Date.now());

  const rolled = maybeRollSeason(Date.now());
  assert.equal(rolled.rolled, true);

  const snapshotCount = db.prepare('SELECT COUNT(*) AS c FROM pm_season_snapshots WHERE season_id = ?').get(oldSeasonId).c;
  assert.ok(snapshotCount >= 1);

  const oldUserRows = db.prepare('SELECT COUNT(*) AS c FROM pm_users WHERE season_id = ?').get(oldSeasonId).c;
  const oldStatsRows = db.prepare('SELECT COUNT(*) AS c FROM pm_user_stats WHERE season_id = ?').get(oldSeasonId).c;
  assert.equal(oldUserRows, 0);
  assert.equal(oldStatsRows, 0);

  db.prepare('DELETE FROM pm_season_snapshots WHERE season_id = ?').run(oldSeasonId);
  db.prepare('DELETE FROM pm_seasons WHERE season_id = ?').run(oldSeasonId);
  cleanupUser(userId);

  // Keep assertion that active season still has data shape.
  const activeRows = listNetWorthLeaderboard(ensureActiveSeason(Date.now()).season_id, 5);
  assert.ok(Array.isArray(activeRows));
});
