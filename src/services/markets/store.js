import crypto from 'node:crypto';
import { db } from '../../memory.js';

export const STARTING_BALANCE = Number.parseFloat(process.env.PAPER_STARTING_BALANCE || '10000') || 10000;

function now() {
  return Date.now();
}

function id(prefix) {
  const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${token}`;
}

export function seasonWindowFromTs(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday, 0, 0, 0, 0);
  const end = start + 7 * 24 * 60 * 60 * 1000;
  const seasonId = `season_${new Date(start).toISOString().slice(0, 10)}`;
  return { seasonId, startsAt: start, endsAt: end };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pm_seasons (
    season_id TEXT PRIMARY KEY,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_users (
    user_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    cash_balance REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, season_id)
  );

  CREATE TABLE IF NOT EXISTS pm_positions (
    user_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    side TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, season_id, ticker, side)
  );

  CREATE TABLE IF NOT EXISTS pm_orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    side TEXT NOT NULL,
    qty INTEGER NOT NULL,
    fill_price REAL NOT NULL,
    notional REAL NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_markets_cache (
    ticker TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    display_title TEXT DEFAULT '',
    display_subtitle TEXT DEFAULT '',
    title_source TEXT DEFAULT 'rules',
    title_updated_at INTEGER DEFAULT 0,
    category TEXT NOT NULL,
    close_time INTEGER NOT NULL,
    yes_price REAL,
    no_price REAL,
    status TEXT NOT NULL,
    source_updated_at INTEGER NOT NULL,
    cached_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_market_resolutions (
    ticker TEXT PRIMARY KEY,
    resolved_outcome TEXT NOT NULL,
    resolved_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_user_stats (
    user_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    trades INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    net_worth REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, season_id)
  );

  CREATE TABLE IF NOT EXISTS pm_user_totals (
    user_id TEXT PRIMARY KEY,
    trades INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_achievement_defs (
    achievement_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pm_user_achievements (
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS pm_season_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    net_worth REAL NOT NULL,
    realized_pnl REAL NOT NULL,
    trades INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    losses INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pm_stats_season_networth ON pm_user_stats(season_id, net_worth DESC);
  CREATE INDEX IF NOT EXISTS idx_pm_positions_ticker ON pm_positions(ticker, season_id);
`);

function isDuplicateColumnError(error) {
  return (
    error &&
    typeof error.message === 'string' &&
    error.message.includes('duplicate column name')
  );
}

for (const migrationSql of [
  "ALTER TABLE pm_markets_cache ADD COLUMN display_title TEXT DEFAULT ''",
  "ALTER TABLE pm_markets_cache ADD COLUMN display_subtitle TEXT DEFAULT ''",
  "ALTER TABLE pm_markets_cache ADD COLUMN title_source TEXT DEFAULT 'rules'",
  "ALTER TABLE pm_markets_cache ADD COLUMN title_updated_at INTEGER DEFAULT 0",
]) {
  try {
    db.exec(migrationSql);
  } catch (err) {
    if (!isDuplicateColumnError(err)) {
      throw err;
    }
  }
}

const upsertSeasonStmt = db.prepare(`
  INSERT INTO pm_seasons (season_id, starts_at, ends_at, status, created_at, updated_at)
  VALUES (?, ?, ?, 'active', ?, ?)
  ON CONFLICT(season_id) DO UPDATE SET
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_at = excluded.updated_at
`);

const findActiveSeasonStmt = db.prepare(`
  SELECT season_id, starts_at, ends_at, status
  FROM pm_seasons
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1
`);

const updateSeasonStatusStmt = db.prepare(`
  UPDATE pm_seasons
  SET status = ?, updated_at = ?
  WHERE season_id = ?
`);

const ensureUserStmt = db.prepare(`
  INSERT INTO pm_users (user_id, season_id, cash_balance, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, season_id) DO NOTHING
`);

const getUserStmt = db.prepare(`
  SELECT user_id, season_id, cash_balance, created_at, updated_at
  FROM pm_users
  WHERE user_id = ? AND season_id = ?
`);

const updateUserCashStmt = db.prepare(`
  UPDATE pm_users SET cash_balance = ?, updated_at = ?
  WHERE user_id = ? AND season_id = ?
`);

const getPositionStmt = db.prepare(`
  SELECT user_id, season_id, ticker, side, qty, avg_price
  FROM pm_positions
  WHERE user_id = ? AND season_id = ? AND ticker = ? AND side = ?
`);

const upsertPositionStmt = db.prepare(`
  INSERT INTO pm_positions (user_id, season_id, ticker, side, qty, avg_price, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, season_id, ticker, side) DO UPDATE SET
    qty = excluded.qty,
    avg_price = excluded.avg_price,
    updated_at = excluded.updated_at
`);

const listUserPositionsStmt = db.prepare(`
  SELECT user_id, season_id, ticker, side, qty, avg_price, updated_at
  FROM pm_positions
  WHERE user_id = ? AND season_id = ?
  ORDER BY ticker, side
`);

const deletePositionsForMarketStmt = db.prepare(
  'DELETE FROM pm_positions WHERE ticker = ? AND season_id = ?'
);

const listMarketPositionsStmt = db.prepare(`
  SELECT user_id, season_id, ticker, side, qty, avg_price
  FROM pm_positions
  WHERE ticker = ? AND season_id = ?
`);

const insertOrderStmt = db.prepare(`
  INSERT INTO pm_orders (order_id, user_id, season_id, ticker, side, qty, fill_price, notional, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertMarketCacheStmt = db.prepare(`
  INSERT INTO pm_markets_cache (
    ticker, title, display_title, display_subtitle, title_source, title_updated_at,
    category, close_time, yes_price, no_price, status, source_updated_at, cached_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ticker) DO UPDATE SET
    title = excluded.title,
    display_title = excluded.display_title,
    display_subtitle = excluded.display_subtitle,
    title_source = excluded.title_source,
    title_updated_at = excluded.title_updated_at,
    category = excluded.category,
    close_time = excluded.close_time,
    yes_price = excluded.yes_price,
    no_price = excluded.no_price,
    status = excluded.status,
    source_updated_at = excluded.source_updated_at,
    cached_at = excluded.cached_at
`);

const getCachedMarketStmt = db.prepare(`
  SELECT ticker, title, display_title, display_subtitle, title_source, title_updated_at, category, close_time, yes_price, no_price, status, source_updated_at, cached_at
  FROM pm_markets_cache
  WHERE ticker = ?
`);

const listCachedMarketsStmt = db.prepare(`
  SELECT ticker, title, display_title, display_subtitle, title_source, title_updated_at, category, close_time, yes_price, no_price, status, source_updated_at, cached_at
  FROM pm_markets_cache
  WHERE (? = '' OR category LIKE ?)
    AND (
      ? = 'all'
      OR (? = 'open' AND status IN ('open', 'active'))
      OR (? = 'closing' AND close_time <= ?)
    )
  ORDER BY cached_at DESC
  LIMIT ?
`);

const upsertResolutionStmt = db.prepare(`
  INSERT INTO pm_market_resolutions (ticker, resolved_outcome, resolved_at)
  VALUES (?, ?, ?)
  ON CONFLICT(ticker) DO UPDATE SET
    resolved_outcome = excluded.resolved_outcome,
    resolved_at = excluded.resolved_at
`);

const getResolutionStmt = db.prepare(
  'SELECT ticker, resolved_outcome, resolved_at FROM pm_market_resolutions WHERE ticker = ?'
);

const upsertSeasonStatsStmt = db.prepare(`
  INSERT INTO pm_user_stats (user_id, season_id, trades, wins, losses, realized_pnl, net_worth, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, season_id) DO UPDATE SET
    trades = excluded.trades,
    wins = excluded.wins,
    losses = excluded.losses,
    realized_pnl = excluded.realized_pnl,
    net_worth = excluded.net_worth,
    updated_at = excluded.updated_at
`);

const getSeasonStatsStmt = db.prepare(`
  SELECT user_id, season_id, trades, wins, losses, realized_pnl, net_worth, updated_at
  FROM pm_user_stats
  WHERE user_id = ? AND season_id = ?
`);

const upsertTotalStatsStmt = db.prepare(`
  INSERT INTO pm_user_totals (user_id, trades, wins, losses, realized_pnl, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    trades = excluded.trades,
    wins = excluded.wins,
    losses = excluded.losses,
    realized_pnl = excluded.realized_pnl,
    updated_at = excluded.updated_at
`);

const getTotalStatsStmt = db.prepare(`
  SELECT user_id, trades, wins, losses, realized_pnl, updated_at
  FROM pm_user_totals
  WHERE user_id = ?
`);

const listLeaderboardStatsStmt = db.prepare(`
  SELECT user_id, season_id, trades, wins, losses, realized_pnl, net_worth, updated_at
  FROM pm_user_stats
  WHERE season_id = ?
  ORDER BY net_worth DESC, realized_pnl DESC, updated_at ASC
  LIMIT ?
`);

const insertSnapshotStmt = db.prepare(`
  INSERT INTO pm_season_snapshots (snapshot_id, season_id, user_id, rank, net_worth, realized_pnl, trades, wins, losses, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const listSeasonStatsStmt = db.prepare(`
  SELECT user_id, season_id, trades, wins, losses, realized_pnl, net_worth, updated_at
  FROM pm_user_stats
  WHERE season_id = ?
  ORDER BY net_worth DESC, realized_pnl DESC, updated_at ASC
`);

const deleteSeasonUserDataStmt = db.prepare('DELETE FROM pm_users WHERE season_id = ?');
const deleteSeasonPositionsStmt = db.prepare('DELETE FROM pm_positions WHERE season_id = ?');
const deleteSeasonStatsStmt = db.prepare('DELETE FROM pm_user_stats WHERE season_id = ?');

const listActiveTickerStmt = db.prepare("SELECT ticker FROM pm_markets_cache WHERE status IN ('open', 'active', 'settled', 'closed', 'final')");

const upsertAchievementDefStmt = db.prepare(`
  INSERT INTO pm_achievement_defs (achievement_id, name, description, sort_order)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(achievement_id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order
`);

const listAchievementDefsStmt = db.prepare(`
  SELECT achievement_id, name, description, sort_order
  FROM pm_achievement_defs
  ORDER BY sort_order ASC, achievement_id ASC
`);

const listUserAchievementsStmt = db.prepare(`
  SELECT ua.user_id, ua.achievement_id, ua.unlocked_at, d.name, d.description
  FROM pm_user_achievements ua
  LEFT JOIN pm_achievement_defs d ON d.achievement_id = ua.achievement_id
  WHERE ua.user_id = ?
  ORDER BY ua.unlocked_at ASC
`);

const grantAchievementStmt = db.prepare(`
  INSERT INTO pm_user_achievements (user_id, achievement_id, unlocked_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, achievement_id) DO NOTHING
`);

const hasAchievementStmt = db.prepare(
  'SELECT 1 as found FROM pm_user_achievements WHERE user_id = ? AND achievement_id = ? LIMIT 1'
);

const seedAchievementDefs = [
  ['first_trade', 'First Trade', 'Place your first paper trade.', 1],
  ['first_win', 'First Win', 'Win your first settled market.', 2],
  ['ten_trades', 'Ten Trades', 'Place 10 paper trades.', 3],
];

for (const row of seedAchievementDefs) {
  upsertAchievementDefStmt.run(...row);
}

export function ensureActiveSeason(ts = Date.now()) {
  const active = findActiveSeasonStmt.get();
  if (active && active.starts_at <= ts && ts < active.ends_at) {
    return active;
  }
  const season = seasonWindowFromTs(ts);
  const currentTs = now();
  upsertSeasonStmt.run(season.seasonId, season.startsAt, season.endsAt, currentTs, currentTs);
  if (active?.season_id && active.season_id !== season.seasonId) {
    updateSeasonStatusStmt.run('ended', currentTs, active.season_id);
  }
  return findActiveSeasonStmt.get() || {
    season_id: season.seasonId,
    starts_at: season.startsAt,
    ends_at: season.endsAt,
    status: 'active',
  };
}

export function ensureUserWallet(userId, seasonId) {
  const ts = now();
  ensureUserStmt.run(userId, seasonId, STARTING_BALANCE, ts, ts);
  return getUserStmt.get(userId, seasonId);
}

export function getUserWallet(userId, seasonId) {
  return getUserStmt.get(userId, seasonId) || null;
}

export function setUserCashBalance(userId, seasonId, cashBalance) {
  updateUserCashStmt.run(cashBalance, now(), userId, seasonId);
}

export function getPosition(userId, seasonId, ticker, side) {
  return getPositionStmt.get(userId, seasonId, ticker, side) || null;
}

export function upsertPosition({ userId, seasonId, ticker, side, qty, avgPrice }) {
  upsertPositionStmt.run(userId, seasonId, ticker, side, qty, avgPrice, now());
}

export function listUserPositions(userId, seasonId) {
  return listUserPositionsStmt.all(userId, seasonId);
}

export function listPositionsForMarket(ticker, seasonId) {
  return listMarketPositionsStmt.all(ticker, seasonId);
}

export function clearPositionsForMarket(ticker, seasonId) {
  return deletePositionsForMarketStmt.run(ticker, seasonId).changes;
}

export function createOrder({ userId, seasonId, ticker, side, qty, fillPrice, notional, status = 'filled' }) {
  const orderId = id('ord');
  insertOrderStmt.run(orderId, userId, seasonId, ticker, side, qty, fillPrice, notional, status, now());
  return orderId;
}

export function upsertMarketCache(market) {
  const timestamp = now();
  upsertMarketCacheStmt.run(
    market.ticker,
    market.title || market.ticker,
    market.displayTitle || market.display_title || market.title || market.ticker,
    market.displaySubtitle || market.display_subtitle || '',
    market.titleSource || market.title_source || 'rules',
    Number(market.titleUpdatedAt || market.title_updated_at) || timestamp,
    market.category || 'general',
    Number(market.closeTime) || 0,
    Number.isFinite(Number(market.yesPrice)) ? Number(market.yesPrice) : null,
    Number.isFinite(Number(market.noPrice)) ? Number(market.noPrice) : null,
    market.status || 'open',
    Number(market.sourceUpdatedAt) || now(),
    timestamp
  );
}

export function getCachedMarket(ticker) {
  return getCachedMarketStmt.get(ticker) || null;
}

export function listCachedMarkets({ category = '', status = 'open', limit = 10 } = {}) {
  const lowerStatus = String(status || 'open').toLowerCase();
  const lcCategory = String(category || '').toLowerCase();
  const cap = Math.max(1, Math.min(Number(limit) || 10, 100));
  const closingCutoff = now() + 24 * 60 * 60 * 1000;
  return listCachedMarketsStmt.all(lcCategory, `%${lcCategory}%`, lowerStatus, lowerStatus, lowerStatus, closingCutoff, cap);
}

export function upsertResolution(ticker, outcome) {
  const safe = String(outcome || '').toLowerCase();
  if (!['yes', 'no'].includes(safe)) return;
  upsertResolutionStmt.run(ticker, safe, now());
}

export function getResolution(ticker) {
  return getResolutionStmt.get(ticker) || null;
}

export function getUserSeasonStats(userId, seasonId) {
  return getSeasonStatsStmt.get(userId, seasonId) || null;
}

export function upsertUserSeasonStats({ userId, seasonId, trades = 0, wins = 0, losses = 0, realizedPnl = 0, netWorth = 0 }) {
  upsertSeasonStatsStmt.run(userId, seasonId, trades, wins, losses, realizedPnl, netWorth, now());
}

export function getUserTotals(userId) {
  return getTotalStatsStmt.get(userId) || null;
}

export function upsertUserTotals({ userId, trades = 0, wins = 0, losses = 0, realizedPnl = 0 }) {
  upsertTotalStatsStmt.run(userId, trades, wins, losses, realizedPnl, now());
}

export function listNetWorthLeaderboard(seasonId, limit = 10) {
  return listLeaderboardStatsStmt.all(seasonId, Math.min(Math.max(Number(limit) || 10, 1), 100));
}

export function listSeasonStats(seasonId) {
  return listSeasonStatsStmt.all(seasonId);
}

export function snapshotAndArchiveSeason(seasonId) {
  const rows = listSeasonStats(seasonId);
  const ts = now();
  let rank = 0;
  for (const row of rows) {
    rank += 1;
    insertSnapshotStmt.run(
      id('snap'),
      seasonId,
      row.user_id,
      rank,
      Number(row.net_worth) || 0,
      Number(row.realized_pnl) || 0,
      Number(row.trades) || 0,
      Number(row.wins) || 0,
      Number(row.losses) || 0,
      ts
    );
  }
  updateSeasonStatusStmt.run('ended', ts, seasonId);
  return rows.length;
}

export function resetSeasonData(seasonId) {
  deleteSeasonPositionsStmt.run(seasonId);
  deleteSeasonStatsStmt.run(seasonId);
  deleteSeasonUserDataStmt.run(seasonId);
}

export function maybeRollSeason(ts = Date.now()) {
  const active = findActiveSeasonStmt.get();
  if (!active) {
    const seeded = ensureActiveSeason(ts);
    return { rolled: false, seasonId: seeded.season_id };
  }
  if (ts < active.ends_at) {
    return { rolled: false, seasonId: active.season_id };
  }

  const archived = snapshotAndArchiveSeason(active.season_id);
  resetSeasonData(active.season_id);
  const next = ensureActiveSeason(ts);
  return {
    rolled: true,
    previousSeasonId: active.season_id,
    seasonId: next.season_id,
    archivedUsers: archived,
  };
}

export function listActiveTickers() {
  return listActiveTickerStmt.all().map((row) => row.ticker);
}

export function getAchievementDefs() {
  return listAchievementDefsStmt.all();
}

export function getUserAchievements(userId) {
  return listUserAchievementsStmt.all(userId);
}

export function hasAchievement(userId, achievementId) {
  return Boolean(hasAchievementStmt.get(userId, achievementId));
}

export function grantAchievement(userId, achievementId) {
  const ts = now();
  const result = grantAchievementStmt.run(userId, achievementId, ts);
  return result.changes > 0 ? ts : 0;
}

export const writeTradeTransaction = db.transaction((input) => {
  const {
    userId,
    seasonId,
    ticker,
    side,
    qty,
    fillPrice,
    notional,
    newCash,
    newPositionQty,
    newAvgPrice,
  } = input;

  setUserCashBalance(userId, seasonId, newCash);
  upsertPosition({
    userId,
    seasonId,
    ticker,
    side,
    qty: newPositionQty,
    avgPrice: newAvgPrice,
  });
  const orderId = createOrder({ userId, seasonId, ticker, side, qty, fillPrice, notional, status: 'filled' });
  return { orderId };
});
