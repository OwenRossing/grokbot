import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  cancelTradeByActor,
  createTradeOffer,
  expirePendingTradeIfNeeded,
  getTrade,
  rejectTradeByActor,
  settleTrade,
} from './tcgStore.js';

const TRADE_TTL_MS = 15 * 60 * 1000;

export function buildTradeButtons(tradeId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tcg_trade:accept:${tradeId}`)
        .setLabel('Accept Trade')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tcg_trade:reject:${tradeId}`)
        .setLabel('Reject Trade')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

export function createOffer(params) {
  const expiresAt = Date.now() + TRADE_TTL_MS;
  return createTradeOffer({ ...params, expiresAt });
}

export function rejectOffer(tradeId, actorUserId) {
  return rejectTradeByActor(tradeId, actorUserId);
}

export function cancelOffer(tradeId, actorUserId) {
  return cancelTradeByActor(tradeId, actorUserId);
}

export function acceptOffer(tradeId, accepterUserId) {
  return settleTrade(tradeId, accepterUserId);
}

export function getTradeWithExpiry(tradeId) {
  const trade = expirePendingTradeIfNeeded(tradeId);
  return trade || getTrade(tradeId);
}
