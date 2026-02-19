import { PermissionFlagsBits } from 'discord.js';
import { syncSetFromApi } from '../services/tcg/tcgApi.js';
import { runPackRevealAnimation } from '../services/tcg/animationEngine.js';
import { rollPack } from '../services/tcg/packEngine.js';
import {
  addCredits,
  createOpenWithMint,
  getCardById,
  getCardInstance,
  getCardValue,
  getFreePackAvailability,
  getInventoryPage,
  getTcgOverview,
  getWallet,
  grantAdminCards,
  grantAdminCredits,
  listAdminEvents,
  listTradesForUser,
  parseCsvIds,
  setAdminMultiplier,
  setTradeLocked,
} from '../services/tcg/tcgStore.js';
import {
  acceptOffer,
  buildTradeButtons,
  cancelOffer,
  createOffer,
  getTradeWithExpiry,
  rejectOffer,
} from '../services/tcg/tradeEngine.js';

function isAdmin(interaction, superAdminId) {
  return (
    interaction.user.id === superAdminId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function summarizeTrade(trade) {
  if (!trade) return 'Trade not found.';
  const offerCards = JSON.parse(trade.offer_cards_json || '[]');
  const requestCards = JSON.parse(trade.request_cards_json || '[]');
  return [
    `Trade ID: \`${trade.trade_id}\``,
    `Status: ${trade.status}`,
    `From: <@${trade.offered_by_user_id}> -> <@${trade.offered_to_user_id}>`,
    `Offer cards: ${offerCards.length}`,
    `Request cards: ${requestCards.length}`,
    `Offer credits: ${trade.offer_credits}`,
    `Request credits: ${trade.request_credits}`,
  ].join('\n');
}

async function requireSetCached(setCode) {
  await syncSetFromApi(setCode);
}

export async function executeTcgCommand(interaction, { superAdminId } = {}) {
  const action = interaction.options.getString('action', true);
  const setCode = interaction.options.getString('set_code') || '';
  const productCode = interaction.options.getString('product_code') || '';
  const quantity = interaction.options.getInteger('quantity') || 1;
  const targetUser = interaction.options.getUser('target_user');
  const csvCards = interaction.options.getString('card_instance_ids') || '';
  const csvRequestCards = interaction.options.getString('request_instance_ids') || '';
  const credits = interaction.options.getInteger('credits') || 0;
  const tradeId = interaction.options.getString('trade_id') || '';
  const page = interaction.options.getInteger('page') || 1;
  const filter = interaction.options.getString('filter') || '';

  if (action === 'open_pack') {
    if (!setCode) {
      await interaction.reply({ content: 'Provide `set_code` (e.g. sv1, swsh12).', ephemeral: true });
      return;
    }
    const availability = getFreePackAvailability(interaction.user.id);
    if (!availability.available) {
      const secs = Math.ceil(availability.availableInMs / 1000);
      await interaction.reply({
        content: `Free pack cooldown active. Try again <t:${Math.floor((Date.now() + availability.availableInMs) / 1000)}:R> (${secs}s).`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: false });
    await requireSetCached(setCode);
    const pulls = rollPack({ setCode, productCode: productCode || `${setCode}-default` });
    const created = createOpenWithMint({
      idempotencyKey: interaction.id,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      setCode,
      productCode: productCode || `${setCode}-default`,
      pulls,
    });
    await runPackRevealAnimation(interaction, created.result.minted);
    const rewards = created.result.rewards;
    const final = `${interaction.user} opened a ${setCode} booster.\n` +
      `Minted cards: ${created.result.minted.length}\n` +
      `Credits earned: ${rewards.earned} (base ${rewards.base} + streak ${rewards.streakBonus})`;
    await interaction.followUp({ content: final });
    return;
  }

  if (action === 'inventory') {
    const inv = getInventoryPage({
      userId: targetUser?.id || interaction.user.id,
      page,
      pageSize: 10,
      setCode,
      nameLike: filter,
    });
    const lines = inv.rows.map((row, idx) =>
      `${idx + 1}. \`${row.instance_id}\` ${row.name} [${row.rarity || 'Unknown'}] (${row.set_code})`
    );
    const titleUser = targetUser ? `${targetUser.username}` : 'You';
    await interaction.reply({
      content:
        `${titleUser} inventory page ${inv.page}/${inv.totalPages} (${inv.total} cards)\n` +
        `${lines.join('\n') || 'No cards.'}`,
      ephemeral: true,
    });
    return;
  }

  if (action === 'card_view') {
    if (!csvCards) {
      await interaction.reply({ content: 'Provide `card_instance_ids` with one instance id.', ephemeral: true });
      return;
    }
    const id = parseCsvIds(csvCards)[0];
    const card = getCardInstance(id);
    if (!card) {
      await interaction.reply({ content: 'Card instance not found.', ephemeral: true });
      return;
    }
    const value = getCardValue(card);
    await interaction.reply({
      content:
        `Instance: \`${card.instance_id}\`\n` +
        `Card: ${card.name}\n` +
        `Rarity: ${card.rarity}\n` +
        `Set: ${card.set_code}\n` +
        `Owner: <@${card.owner_user_id}>\n` +
        `State: ${card.state}\n` +
        `Value: ${money(value.valueUsd)} (${value.source})`,
      ephemeral: true,
    });
    return;
  }

  if (action === 'collection_stats') {
    const overview = getTcgOverview(targetUser?.id || interaction.user.id);
    await interaction.reply({
      content:
        `Cards: ${overview.inventoryCount}\n` +
        `Credits: ${overview.wallet.credits}\n` +
        `Opened packs: ${overview.wallet.opened_count}\n` +
        `Streak: ${overview.wallet.streak_days}\n` +
        `Free pack: ${overview.cooldown.available ? 'ready' : `<t:${Math.floor(overview.cooldown.nextAt / 1000)}:R>`}`,
      ephemeral: true,
    });
    return;
  }

  if (action === 'trade_offer') {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Trade offers are guild-only.', ephemeral: true });
      return;
    }
    if (!targetUser) {
      await interaction.reply({ content: 'Provide `target_user`.', ephemeral: true });
      return;
    }
    const offerCards = parseCsvIds(csvCards);
    const reqCards = parseCsvIds(csvRequestCards);
    if (!offerCards.length) {
      await interaction.reply({ content: 'Provide offered `card_instance_ids`.', ephemeral: true });
      return;
    }
    const trade = createOffer({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      offeredByUserId: interaction.user.id,
      offeredToUserId: targetUser.id,
      offerCardIds: offerCards,
      requestCardIds: reqCards,
      offerCredits: Math.max(0, credits),
      requestCredits: 0,
    });
    await interaction.reply({
      content: `${interaction.user} offered a trade to ${targetUser}.\n${summarizeTrade(trade)}`,
      components: buildTradeButtons(trade.trade_id),
      ephemeral: false,
    });
    return;
  }

  if (action === 'trade_accept') {
    if (!tradeId) {
      await interaction.reply({ content: 'Provide `trade_id`.', ephemeral: true });
      return;
    }
    const settled = acceptOffer(tradeId, interaction.user.id);
    await interaction.reply({ content: `Trade settled.\n${summarizeTrade(settled)}`, ephemeral: false });
    return;
  }

  if (action === 'trade_reject') {
    if (!tradeId) {
      await interaction.reply({ content: 'Provide `trade_id`.', ephemeral: true });
      return;
    }
    const result = rejectOffer(tradeId);
    await interaction.reply({ content: `Trade rejected.\n${summarizeTrade(result)}`, ephemeral: false });
    return;
  }

  if (action === 'trade_cancel') {
    if (!tradeId) {
      await interaction.reply({ content: 'Provide `trade_id`.', ephemeral: true });
      return;
    }
    const result = cancelOffer(tradeId);
    await interaction.reply({ content: `Trade cancelled.\n${summarizeTrade(result)}`, ephemeral: true });
    return;
  }

  if (action === 'trade_view') {
    const trades = listTradesForUser(interaction.user.id);
    if (!trades.length) {
      await interaction.reply({ content: 'No trades found.', ephemeral: true });
      return;
    }
    const lines = trades.slice(0, 10).map((t) =>
      `\`${t.trade_id}\` ${t.status} <@${t.offered_by_user_id}> -> <@${t.offered_to_user_id}>`
    );
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    return;
  }

  if (action === 'market_value') {
    if (!csvCards) {
      await interaction.reply({ content: 'Provide one card id or instance id in `card_instance_ids`.', ephemeral: true });
      return;
    }
    const rawId = parseCsvIds(csvCards)[0];
    const instance = getCardInstance(rawId);
    const card = instance || getCardById(rawId);
    if (!card) {
      await interaction.reply({ content: 'Card not found.', ephemeral: true });
      return;
    }
    const value = getCardValue(card);
    const name = card.name || card.card_id;
    await interaction.reply({ content: `${name} value: ${money(value.valueUsd)} (${value.source})`, ephemeral: true });
    return;
  }

  if (action === 'admin_grant_pack') {
    if (!isAdmin(interaction, superAdminId)) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    if (!targetUser || !setCode) {
      await interaction.reply({ content: 'Provide `target_user` and `set_code`.', ephemeral: true });
      return;
    }
    await requireSetCached(setCode);
    const pulls = rollPack({ setCode, productCode: productCode || `${setCode}-default` });
    const minted = grantAdminCards(interaction.user.id, targetUser.id, pulls.map((p) => p.card_id), 'admin_pack_grant');
    await interaction.reply({ content: `Granted ${minted.length} cards to ${targetUser}.`, ephemeral: false });
    return;
  }

  if (action === 'admin_grant_credits') {
    if (!isAdmin(interaction, superAdminId)) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    if (!targetUser || !credits) {
      await interaction.reply({ content: 'Provide `target_user` and non-zero `credits`.', ephemeral: true });
      return;
    }
    const wallet = grantAdminCredits(interaction.user.id, targetUser.id, credits, 'admin_grant_credits');
    await interaction.reply({ content: `Updated ${targetUser} credits: ${wallet.credits}.`, ephemeral: false });
    return;
  }

  if (action === 'admin_set_multiplier') {
    if (!isAdmin(interaction, superAdminId)) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    if (!filter || !setCode) {
      await interaction.reply({ content: 'Use `filter` as key and `set_code` as value (e.g. key=credit_multiplier, value=1.5).', ephemeral: true });
      return;
    }
    setAdminMultiplier(interaction.user.id, filter, setCode);
    await interaction.reply({ content: `Multiplier updated: ${filter}=${setCode}.`, ephemeral: true });
    return;
  }

  if (action === 'admin_trade_lock') {
    if (!isAdmin(interaction, superAdminId)) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    const enabled = String(filter || '').toLowerCase() === 'on' || String(filter || '').toLowerCase() === 'true';
    setTradeLocked(interaction.user.id, enabled);
    await interaction.reply({ content: `Trading lock is now ${enabled ? 'ON' : 'OFF'}.`, ephemeral: false });
    return;
  }

  if (action === 'admin_audit') {
    if (!isAdmin(interaction, superAdminId)) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    const rows = listAdminEvents(Math.max(1, Math.min(50, quantity || 20)));
    const lines = rows.map((r) => `\`${r.event_id}\` ${r.action} by <@${r.admin_user_id}> at <t:${Math.floor(r.created_at / 1000)}:R>`);
    await interaction.reply({ content: lines.join('\n') || 'No admin events.', ephemeral: true });
    return;
  }

  if (action === 'admin_rollback_trade') {
    await interaction.reply({
      content: 'Rollback is reserved for v2 safety checks. For now, use admin grants to remediate.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: 'Unknown TCG action.', ephemeral: true });
}

export async function executeTcgTradeButton(interaction) {
  const [prefix, action, tradeId] = String(interaction.customId || '').split(':');
  if (prefix !== 'tcg_trade' || !tradeId) return false;

  try {
    const trade = getTradeWithExpiry(tradeId);
    if (!trade) {
      await interaction.reply({ content: 'Trade not found.', ephemeral: true });
      return true;
    }
    if (action === 'accept') {
      const settled = acceptOffer(tradeId, interaction.user.id);
      await interaction.update({
        content: `Trade accepted.\n${summarizeTrade(settled)}`,
        components: [],
      });
      return true;
    }
    if (action === 'reject') {
      if (interaction.user.id !== trade.offered_to_user_id) {
        await interaction.reply({ content: 'Only the target user can reject this trade.', ephemeral: true });
        return true;
      }
      const rejected = rejectOffer(tradeId);
      await interaction.update({
        content: `Trade rejected.\n${summarizeTrade(rejected)}`,
        components: [],
      });
      return true;
    }
    await interaction.reply({ content: 'Unknown trade action.', ephemeral: true });
    return true;
  } catch (err) {
    await interaction.reply({ content: `Trade action failed: ${err.message}`, ephemeral: true });
    return true;
  }
}

