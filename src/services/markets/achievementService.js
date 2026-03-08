import {
  getAchievementDefs,
  getUserAchievements,
  getUserSeasonStats,
  grantAchievement,
  hasAchievement,
} from './store.js';

const FIRST_TRADE = 'first_trade';
const FIRST_WIN = 'first_win';
const TEN_TRADES = 'ten_trades';

export function evaluateAchievementUnlocks({ userId, seasonId }) {
  const stats = getUserSeasonStats(userId, seasonId) || {
    trades: 0,
    wins: 0,
  };

  const unlocked = [];
  const trades = Number(stats.trades) || 0;
  const wins = Number(stats.wins) || 0;

  if (trades >= 1 && !hasAchievement(userId, FIRST_TRADE)) {
    const ts = grantAchievement(userId, FIRST_TRADE);
    if (ts) unlocked.push({ achievementId: FIRST_TRADE, unlockedAt: ts });
  }

  if (wins >= 1 && !hasAchievement(userId, FIRST_WIN)) {
    const ts = grantAchievement(userId, FIRST_WIN);
    if (ts) unlocked.push({ achievementId: FIRST_WIN, unlockedAt: ts });
  }

  if (trades >= 10 && !hasAchievement(userId, TEN_TRADES)) {
    const ts = grantAchievement(userId, TEN_TRADES);
    if (ts) unlocked.push({ achievementId: TEN_TRADES, unlockedAt: ts });
  }

  return unlocked;
}

export function listUserAchievements(userId) {
  return getUserAchievements(userId);
}

export function listAchievementDefinitions() {
  return getAchievementDefs();
}
