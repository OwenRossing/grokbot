import { EmbedBuilder } from 'discord.js';
import { evaluateAchievementUnlocks, listUserAchievements } from '../services/markets/achievementService.js';
import { getMarketByTicker, listMarkets } from '../services/markets/kalshiClient.js';
import { getNetWorthLeaderboard } from '../services/markets/leaderboardService.js';
import { placeBuyOrder } from '../services/markets/paperEngine.js';
import {
  ensureActiveSeason,
  ensureUserWallet,
  getCachedMarket,
  getUserSeasonStats,
  listCachedMarkets,
  listUserPositions,
  STARTING_BALANCE,
  upsertMarketCache,
} from '../services/markets/store.js';
import { computeNetWorth, refreshUserNetWorth } from '../services/markets/statsService.js';

const DISCLAIMER = 'Paper trading only. No real money. Not financial advice.';

function dollars(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatMarketLine(market) {
  const closeTs = Number(market.closeTime || market.close_time) || 0;
  const status = String(market.status || 'open');
  const yes = Number(market.yesPrice ?? market.yes_price);
  const no = Number(market.noPrice ?? market.no_price);
  return [
    `\`${market.ticker}\` ${market.title || '(untitled market)'}`,
    `YES ${Number.isFinite(yes) ? `${yes}¢` : '—'} • NO ${Number.isFinite(no) ? `${no}¢` : '—'} • ${status}${closeTs > 0 ? ` • closes <t:${Math.floor(closeTs / 1000)}:R>` : ''}`,
  ].join('\n');
}

export async function executeMarketsCommand(interaction) {
  const sub = interaction.options.getSubcommand(true);

  if (sub === 'list') {
    const category = interaction.options.getString('category') || '';
    const status = interaction.options.getString('status') || 'open';
    const limit = Math.min(Math.max(interaction.options.getInteger('limit') || 10, 1), 25);

    let markets = [];
    let stale = false;
    try {
      markets = await listMarkets({ category, status, limit });
      for (const market of markets) upsertMarketCache(market);
    } catch (err) {
      stale = true;
      markets = listCachedMarkets({ category, status, limit }).map((row) => ({
        ticker: row.ticker,
        title: row.title,
        category: row.category,
        closeTime: row.close_time,
        yesPrice: row.yes_price,
        noPrice: row.no_price,
        status: row.status,
      }));
    }

    const embed = new EmbedBuilder()
      .setTitle('Prediction Markets')
      .setDescription(markets.length
        ? markets.map(formatMarketLine).join('\n\n')
        : 'No markets available for that filter.')
      .setFooter({ text: `${DISCLAIMER}${stale ? ' • Showing cached data.' : ''}` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: false });
    return;
  }

  if (sub === 'view') {
    const ticker = interaction.options.getString('ticker', true).trim();
    let market = null;
    let stale = false;
    try {
      market = await getMarketByTicker(ticker);
      upsertMarketCache(market);
    } catch (err) {
      stale = true;
      const cached = getCachedMarket(ticker);
      if (!cached) {
        await interaction.reply({ content: `Market \`${ticker}\` not found.`, ephemeral: true });
        return;
      }
      market = {
        ticker: cached.ticker,
        title: cached.title,
        category: cached.category,
        closeTime: cached.close_time,
        yesPrice: cached.yes_price,
        noPrice: cached.no_price,
        status: cached.status,
      };
    }

    const embed = new EmbedBuilder()
      .setTitle(`${market.ticker} • ${market.title || 'Market'}`)
      .addFields(
        { name: 'Category', value: market.category || 'general', inline: true },
        { name: 'Status', value: market.status || 'open', inline: true },
        { name: 'Close', value: market.closeTime ? `<t:${Math.floor(Number(market.closeTime) / 1000)}:f>` : 'Unknown', inline: true },
        { name: 'YES', value: Number.isFinite(Number(market.yesPrice)) ? `${Math.round(Number(market.yesPrice))}¢` : '—', inline: true },
        { name: 'NO', value: Number.isFinite(Number(market.noPrice)) ? `${Math.round(Number(market.noPrice))}¢` : '—', inline: true }
      )
      .setFooter({ text: `${DISCLAIMER}${stale ? ' • Showing cached data.' : ''}` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }
}

export async function executeBetCommand(interaction) {
  const sub = interaction.options.getSubcommand(true);
  if (sub !== 'buy') {
    await interaction.reply({ content: 'Unknown bet action.', ephemeral: true });
    return;
  }

  const ticker = interaction.options.getString('ticker', true).trim();
  const side = interaction.options.getString('side', true).trim().toLowerCase();
  const qty = interaction.options.getInteger('qty', true);

  try {
    const market = await getMarketByTicker(ticker);
    upsertMarketCache(market);
  } catch {
    const cached = getCachedMarket(ticker);
    if (!cached) {
      await interaction.reply({ content: `Unable to fetch market \`${ticker}\` right now and no cached snapshot exists.`, ephemeral: true });
      return;
    }
  }

  try {
    const result = placeBuyOrder({
      userId: interaction.user.id,
      ticker,
      side,
      qty,
    });

    const unlockNames = result.achievements.map((a) => `\`${a.achievementId}\``).join(', ');
    const embed = new EmbedBuilder()
      .setTitle('Paper Trade Filled')
      .setDescription([
        `Order: \`${result.orderId}\``,
        `Market: \`${result.ticker}\` • ${result.side.toUpperCase()} x${result.qty}`,
        `Fill: ${Math.round(result.fillPrice)}¢ (${dollars(result.notional)})`,
        `Cash: ${dollars(result.cashAfter)}`,
        `Net worth: ${dollars(result.netWorth)}`,
        unlockNames ? `Achievements unlocked: ${unlockNames}` : '',
      ].filter(Boolean).join('\n'))
      .setFooter({ text: DISCLAIMER })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: false });
  } catch (err) {
    await interaction.reply({ content: `Trade failed: ${err.message}`, ephemeral: true });
  }
}

export async function executePortfolioCommand(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const season = ensureActiveSeason(Date.now());
  const wallet = ensureUserWallet(targetUser.id, season.season_id);
  const positions = listUserPositions(targetUser.id, season.season_id);
  const stats = refreshUserNetWorth(targetUser.id, season.season_id) || {
    netWorth: wallet.cash_balance,
  };

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
  const seasonStats = getUserSeasonStats(targetUser.id, season.season_id);

  const lines = positions.slice(0, 12).map((pos) => {
    const market = marketByTicker.get(pos.ticker);
    const mark = pos.side === 'yes' ? market?.yes_price : market?.no_price;
    return `\`${pos.ticker}\` ${pos.side.toUpperCase()} x${pos.qty} @ ${Math.round(Number(pos.avg_price))}¢ ${Number.isFinite(Number(mark)) ? `(mark ${Math.round(Number(mark))}¢)` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${targetUser.username}'s Portfolio`)
    .setDescription(lines.length ? lines.join('\n') : 'No open positions yet.')
    .addFields(
      { name: 'Season', value: season.season_id, inline: true },
      { name: 'Cash', value: dollars(wallet.cash_balance), inline: true },
      { name: 'Net Worth', value: dollars(netWorth), inline: true },
      { name: 'Realized PnL', value: dollars(seasonStats?.realized_pnl || 0), inline: true },
      { name: 'Trades', value: String(seasonStats?.trades || 0), inline: true },
      { name: 'Starting Balance', value: dollars(STARTING_BALANCE), inline: true }
    )
    .setFooter({ text: DISCLAIMER })
    .setTimestamp(new Date());

  const ephemeral = interaction.channel?.isDMBased?.() ? true : false;
  await interaction.reply({ embeds: [embed], ephemeral });
}

export async function executeLeaderboardCommand(interaction) {
  const type = interaction.options.getString('type', true);
  if (type !== 'net_worth') {
    await interaction.reply({ content: 'Only `net_worth` leaderboard is available in v1.', ephemeral: true });
    return;
  }

  const season = ensureActiveSeason(Date.now());
  const rows = getNetWorthLeaderboard(season.season_id, 10);
  const lines = rows.map((row, idx) => (
    `${idx + 1}. <@${row.user_id}> • ${dollars(row.net_worth)} (PnL ${dollars(row.realized_pnl)})`
  ));

  const embed = new EmbedBuilder()
    .setTitle(`Leaderboard • ${season.season_id}`)
    .setDescription(lines.join('\n') || 'No entries yet. Place a trade with `/bet buy`.')
    .setFooter({ text: DISCLAIMER })
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

export async function executeAchievementsCommand(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const season = ensureActiveSeason(Date.now());
  evaluateAchievementUnlocks({ userId: targetUser.id, seasonId: season.season_id });
  const rows = listUserAchievements(targetUser.id);

  const embed = new EmbedBuilder()
    .setTitle(`${targetUser.username}'s Achievements`)
    .setDescription(rows.length
      ? rows.map((row) => `• **${row.name || row.achievement_id}** - ${row.description || ''}`).join('\n')
      : 'No achievements unlocked yet.')
    .setFooter({ text: DISCLAIMER })
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [embed], ephemeral: false });
}
