import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { syncSetFromApi } from '../services/tcg/tcgApi.js';
import { rollPack, rollPackDetailed } from '../services/tcg/packEngine.js';
import { renderRevealGif } from '../services/tcg/revealRenderer.js';
import { getCardEstimatedPrice } from '../services/pricing/pokemonTcgApiPricing.js';
import {
  formatPackDisplayName,
  formatRarity,
  resolveSetName,
} from '../services/catalog/catalogResolver.js';
import {
  buildCompletionEmbedData,
  buildPackOpenHeadline,
} from '../services/tcg/tcgUx.js';
import {
  resolveEphemeralVisibility,
  VisibilityCategory,
} from '../services/visibilityPolicy.js';
import {
  browseMarketCatalog,
  createOpenWithMint,
  claimCooldownPack,
  claimPack,
  executeMarketBuy,
  executeMarketSellDuplicates,
  executeTradeInDuplicates,
  executeMarketSellInstances,
  activateDueLiveEvents,
  createLiveEvent,
  deleteLiveEvent,
  expireEndedLiveEvents,
  getEffectiveEventEffects,
  getBuyQuote,
  getCardById,
  getCardInstance,
  getDuplicateSummaryForUser,
  getOwnedCardAutocompleteChoices,
  getOwnedInstanceAutocompleteChoices,
  getSetAutocompleteChoices,
  getSetCompletionForUser,
  getTradeAutocompleteChoicesByStatus,
  getLiveEventAutocompleteChoices,
  getTradeAutocompleteChoicesForUser,
  getUnopenedPackAutocompleteChoices,
  resolveOwnedInstanceIdsForSelection,
  getSellQuoteForInstances,
  getSet,
  getTcgUserSettings,
  getClaimablePack,
  getCardsBySet,
  getFreePackAvailability,
  getInventoryPage,
  grantAdminSealedPacks,
  listCachedSetCodes,
  listClaimablePacks,
  listUnopenedPacks,
  openUnopenedPackWithMint,
  setAutoClaimEnabled,
  getTcgOverview,
  grantAdminCards,
  grantAdminCredits,
  listAdminEvents,
  listLiveEvents,
  listTradesForUser,
  parseCsvIds,
  rollbackSettledTrade,
  setAdminMultiplier,
  setLiveEventNow,
  setLiveEventStatus,
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
import {
  advanceRevealSession,
  createRevealSession,
  getRevealSession,
  setRevealSessionMessage,
} from '../services/tcg/revealSessionStore.js';
import { hasInteractionAdminAccess } from '../utils/auth.js';
import {
  buildPagedEmbed,
  buildPagerComponents,
  warnIfPagedWithoutPager,
} from '../utils/pagination.js';

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function formatEstimatedLine(price) {
  if (!Number.isFinite(Number(price?.dollars))) return 'Estimated: —';
  const base = `Estimated: ${money(price.dollars)}${price?.source ? ` (${price.source})` : ''}`;
  const updatedAt = Number(price?.updatedAt);
  const minimumReasonableTs = Date.UTC(2020, 0, 1);
  if (Number.isFinite(updatedAt) && updatedAt >= minimumReasonableTs && updatedAt <= (Date.now() + 24 * 60 * 60 * 1000)) {
    return `${base} • updated <t:${Math.floor(Number(price.updatedAt) / 1000)}:R>`;
  }
  return base;
}

function isVerboseTcgMode() {
  const value = String(process.env.TCG_VERBOSE_MODE || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function getRevealGifMode() {
  return String(process.env.TCG_REVEAL_GIF_MODE || 'off').trim().toLowerCase();
}

function shouldRenderRevealGif(card) {
  const mode = getRevealGifMode();
  if (mode === 'all') return true;
  if (mode === 'rare_only' || mode === 'shiny_only') {
    return Number(card?.rarity_tier || 0) >= 6;
  }
  return false;
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

function parseSetSyncError(err) {
  const text = String(err?.message || '');
  if (text.includes('set not found') || text.includes('pokemon api 404')) {
    return 'Unknown set code. Try `set_code:sv1` (or use `open_free_pack` with default set).';
  }
  if (text.includes('pokemon api timeout') || /pokemon api (408|429|5\d\d)/.test(text)) {
    return 'Pokemon TCG API is temporarily unavailable. Please try again in a minute.';
  }
  return null;
}

function isTransientSetSyncError(err) {
  const text = String(err?.message || '');
  return text.includes('pokemon api timeout') || /pokemon api (408|429|5\d\d)/.test(text);
}

function normalizeSetCode(value) {
  return String(value || '').trim().toLowerCase();
}

function getSetPreviewUrl(setCode) {
  const set = getSet(setCode);
  return set?.pack_preview_image_url || set?.logo_image_url || set?.symbol_image_url || '';
}

function isAdminForCtx(ctx) {
  return hasInteractionAdminAccess(ctx.interaction, ctx.superAdminId);
}

function getRarityIcon(row) {
  const tier = Number(row?.rarity_tier || 1);
  if (tier >= 6) return '🌟';
  if (tier === 5) return '✨';
  if (tier === 4) return '💠';
  if (tier === 3) return '🔷';
  if (tier === 2) return '🔹';
  return '▫️';
}

function buildInventoryRowsText(rows = []) {
  return rows.map((row, idx) =>
    `${idx + 1}. ${getRarityIcon(row)} ${row.name} [${formatRarity(row.rarity)}] (${resolveSetName(row.set_code)})`
  );
}

function buildInventorySelectRow(rows = []) {
  if (!rows.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId('tcg_inv:select')
    .setPlaceholder('View card...')
    .addOptions(
      rows.slice(0, 25).map((row, idx) => ({
        label: `${idx + 1}. ${row.name}`.slice(0, 100),
        description: `${formatRarity(row.rarity)} • ${resolveSetName(row.set_code)}`.slice(0, 100),
        value: row.instance_id,
      }))
    );
  return new ActionRowBuilder().addComponents(select);
}

function buildInventoryListEmbed({ titleUser, inv, duplicateRows = [] }) {
  const duplicateCopies = duplicateRows.reduce((sum, row) => sum + Math.max(0, Number(row.owned_count || 0) - 1), 0);
  const uniqueCount = Math.max(0, Number(inv.total || 0) - duplicateCopies);
  const lines = buildInventoryRowsText(inv.rows);
  return new EmbedBuilder()
    .setTitle('Your Collection')
    .setDescription(`Viewing: **${titleUser}** • Page ${inv.page}/${inv.totalPages}`)
    .addFields(
      { name: 'Total', value: `${inv.total}`, inline: true },
      { name: 'Unique', value: `${uniqueCount}`, inline: true },
      { name: 'Duplicates', value: `${duplicateCopies}`, inline: true },
      { name: 'Cards', value: lines.join('\n') || 'No cards.', inline: false }
    );
}

async function buildInventoryCardEmbed(instanceId) {
  const card = getCardInstance(instanceId);
  if (!card) return null;
  const cardMeta = getCardById(card.card_id) || {};
  const estimated = await getCardEstimatedPrice(card.card_id);
  const embed = new EmbedBuilder()
    .setTitle(card.name || 'Card')
    .setDescription(`Set ${resolveSetName(card.set_code)} • ${formatRarity(card.rarity)}`)
    .addFields(
      { name: 'Estimated', value: formatEstimatedLine(estimated), inline: false },
      { name: 'State', value: card.state || 'owned', inline: true }
    );
  const image = cardMeta.image_large || cardMeta.image_small || '';
  if (image) embed.setImage(image);
  return embed;
}

function formatActiveEventLines(effects, { setCode = '' } = {}) {
  if (!effects?.enabled) return ['Events are disabled.'];
  const lines = [];
  if (effects.activeByEffect?.bonusPack) {
    lines.push(`Bonus Pack: +${effects.bonusPackCount} on cooldown claim`);
  }
  if (effects.activeByEffect?.dropBoost) {
    lines.push(`Luck Boost: ${effects.dropBoostMultiplier.toFixed(2)}x`);
  }
  if (effects.activeByEffect?.creditBoost) {
    lines.push(`Credit Boost: ${effects.creditMultiplier.toFixed(2)}x rewards`);
  }
  if (!lines.length) {
    lines.push(setCode ? `No active events for ${resolveSetName(setCode)}.` : 'No active events.');
  }
  return lines;
}

async function findSyncableFallbackSetCode(candidates = []) {
  const seen = new Set();
  for (const raw of candidates) {
    const candidate = normalizeSetCode(raw);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await requireSetCached(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return '';
}

function buildTcgContext(interaction, superAdminId) {
  const envDefaultSet = normalizeSetCode(process.env.TCG_DEFAULT_SET_CODE || 'sv1') || 'sv1';
  return {
    interaction,
    superAdminId,
    action: interaction.options.getString('action', true),
    defaultSetCode: envDefaultSet,
    setCode: normalizeSetCode(interaction.options.getString('set_code') || ''),
    productCode: interaction.options.getString('product_code') || '',
    quantity: interaction.options.getInteger('quantity') || 1,
    targetUser: interaction.options.getUser('target_user'),
    csvCards: interaction.options.getString('card_instance_ids') || '',
    csvRequestCards: interaction.options.getString('request_instance_ids') || '',
    credits: interaction.options.getInteger('credits') || 0,
    requestCredits: interaction.options.getInteger('request_credits') || 0,
    tradeId: interaction.options.getString('trade_id') || '',
    packId: interaction.options.getString('pack_id') || '',
    page: interaction.options.getInteger('page') || 1,
    filter: interaction.options.getString('filter') || '',
  };
}

function buildRevealButtons(session) {
  const maxIndex = Math.max(0, session.cards.length - 1);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tcg_reveal:prev:${session.session_id}`)
        .setLabel('Previous Card')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.current_index <= 0),
      new ButtonBuilder()
        .setCustomId(`tcg_reveal:next:${session.session_id}`)
        .setLabel('Next Card')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.current_index >= maxIndex)
    ),
  ];
}

async function buildRevealPayload({ session, user, setCode, rewards, includeValue = false, renderMedia = true }) {
  const card = session.cards[session.current_index];
  if (!card) {
    return {
      content: 'No cards were minted.',
      embeds: [],
      files: [],
      components: [],
    };
  }

  const cardEstimated = includeValue ? await getCardEstimatedPrice(card.card_id) : null;
  const fields = [{ name: 'Set Opened', value: resolveSetName(setCode), inline: true }];
  if (includeValue) {
    fields.unshift({ name: 'Estimated', value: formatEstimatedLine(cardEstimated), inline: true });
  }
  const embed = new EmbedBuilder()
    .setTitle(`${card.name}`)
    .setDescription([
      `Set: ${resolveSetName(card.set_code)}`,
      `Rarity: ${formatRarity(card.rarity)}`,
      `Card ${session.current_index + 1}/${session.cards.length}`,
      rewards
        ? `Credits earned: ${rewards.earned} (base ${rewards.base} + streak ${rewards.streakBonus})`
        : null,
    ].filter(Boolean).join('\n'))
    .addFields(fields)
    .setFooter({ text: `Opened by ${user.username} • Page ${session.current_index + 1}/${session.cards.length}` })
    .setTimestamp(new Date());

  const render = renderMedia && shouldRenderRevealGif(card) ? await renderRevealGif(card) : { ok: false };
  let files = [];
  if (render.ok && render.gifPath) {
    const attachmentName = `tcg-reveal-${session.session_id}-${session.current_index}.gif`;
    files = [new AttachmentBuilder(render.gifPath, { name: attachmentName })];
    embed.setImage(`attachment://${attachmentName}`);
  } else if (card.image_large || card.image_small) {
    embed.setImage(card.image_large || card.image_small);
  }

  const components = buildRevealButtons(session);
  warnIfPagedWithoutPager({ totalPages: session.cards.length, components, source: 'buildRevealPayload' });
  return {
    content: buildPackOpenHeadline({ openerLabel: String(user), setCode }),
    embeds: [embed],
    files,
    components,
  };
}

async function handleOpenPack(ctx) {
  const { interaction, action, setCode, defaultSetCode, productCode } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  const effectiveSetCode = normalizeSetCode(setCode || defaultSetCode);
  if (!effectiveSetCode) {
    await interaction.reply({ content: 'Provide `set_code` (e.g. sv1, swsh12).', ephemeral });
    return;
  }

  if (action === 'open_free_pack') {
    const availability = getFreePackAvailability(interaction.user.id);
    if (!availability.available) {
      const secs = Math.ceil(availability.availableInMs / 1000);
      await interaction.reply({
        content: `Free pack cooldown active. Try again <t:${Math.floor((Date.now() + availability.availableInMs) / 1000)}:R> (${secs}s).`,
        ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply({ ephemeral });
  let selectedSetCode = effectiveSetCode;
  let fallbackNotice = '';
  try {
    await requireSetCached(selectedSetCode);
  } catch (err) {
    const setErr = parseSetSyncError(err);
    if (isTransientSetSyncError(err) && getCardsBySet(selectedSetCode).length > 0) {
      console.warn(`Using cached set data for ${selectedSetCode} due to API outage:`, err.message);
    } else if (isTransientSetSyncError(err)) {
      const fallbackSetCode =
        listCachedSetCodes({ minCards: 20, limit: 1 })[0] ||
        listCachedSetCodes({ minCards: 1, limit: 1 })[0] ||
        '';
      if (fallbackSetCode) {
        selectedSetCode = fallbackSetCode;
        fallbackNotice =
          `Pokemon TCG API is currently unavailable for \`${effectiveSetCode}\`, so I used cached set \`${selectedSetCode}\` instead.`;
        console.warn(
          `Falling back from set ${effectiveSetCode} to cached set ${selectedSetCode} due to API outage:`,
          err.message
        );
      } else if (setErr) {
        await interaction.editReply({ content: setErr, embeds: [], components: [], files: [] });
        return;
      } else {
        throw err;
      }
    } else if (setErr) {
      // For free packs, be lenient with misconfigured defaults and fall back to cached sets.
      if (action === 'open_free_pack') {
        const fallbackFromApi = await findSyncableFallbackSetCode([
          defaultSetCode,
          'sv1',
          'sv2',
          'sv3',
          'swsh12',
        ]);
        if (fallbackFromApi) {
          selectedSetCode = fallbackFromApi;
          fallbackNotice =
            `Default free-pack set \`${effectiveSetCode}\` is invalid, so I used \`${selectedSetCode}\` instead.`;
        } else {
          const fallbackSetCode =
            listCachedSetCodes({ minCards: 20, limit: 1 })[0] ||
            listCachedSetCodes({ minCards: 1, limit: 1 })[0] ||
            '';
          if (fallbackSetCode) {
            selectedSetCode = fallbackSetCode;
            fallbackNotice =
              `Default free-pack set \`${effectiveSetCode}\` is invalid, so I used cached set \`${selectedSetCode}\` instead.`;
          } else {
            await interaction.editReply({
              content:
                `${setErr}\nNo fallback set is available (live or cached). Check \`TCG_DEFAULT_SET_CODE\` (e.g. \`sv1\`) and \`POKEMONTCG_API_BASE_URL\` (expected \`https://api.pokemontcg.io/v2\`).`,
              embeds: [],
              components: [],
              files: [],
            });
            return;
          }
        }
      } else {
        await interaction.editReply({ content: setErr, embeds: [], components: [], files: [] });
        return;
      }
    } else {
      throw err;
    }
  }

  const drop = rollPackDetailed({
    userId: interaction.user.id,
    setCode: selectedSetCode,
    productCode: productCode || `${selectedSetCode}-default`,
  });
  await openPackFromPulls({
    interaction,
    pulls: drop.pulls,
    setCode: selectedSetCode,
    productCode: productCode || `${selectedSetCode}-default`,
    profileVersion: drop.profileVersion,
    dropAudit: drop.audit,
    pityTriggered: drop.pityTriggered,
    fallbackNotice,
  });
}

async function openPackFromPulls({
  interaction,
  pulls,
  setCode,
  productCode,
  profileVersion = '',
  dropAudit = {},
  pityTriggered = false,
  fallbackNotice = '',
}) {
  const created = createOpenWithMint({
    idempotencyKey: interaction.id,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    setCode,
    productCode: productCode || `${setCode}-default`,
    pulls,
    profileVersion,
    dropAudit,
    pityTriggered,
  });

  const revealSession = createRevealSession({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    cards: created.result.minted,
  });

  const payload = await buildRevealPayload({
    session: revealSession,
    user: interaction.user,
    setCode,
    rewards: created.result.rewards,
    includeValue: isVerboseTcgMode(),
    renderMedia: false,
  });
  if (fallbackNotice) {
    payload.content = `${fallbackNotice}\n${payload.content}`;
  }
  const previewImage = getSetPreviewUrl(setCode);
  if (previewImage && payload.embeds?.[0]) {
    payload.embeds[0].setThumbnail(previewImage);
  }

  const sent = await interaction.editReply(payload);
  setRevealSessionMessage(revealSession.session_id, sent.id);
  void upgradeRevealMediaAsync({
    interaction,
    revealSession,
    setCode,
    user: interaction.user,
  });
  return created;
}

async function upgradeRevealMediaAsync({ interaction, revealSession, setCode, user }) {
  const card = revealSession.cards[revealSession.current_index];
  if (!card || !shouldRenderRevealGif(card)) return;
  const timeoutMs = Math.max(250, Number.parseInt(process.env.TCG_REVEAL_MEDIA_UPGRADE_TIMEOUT_MS || '2500', 10));
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  try {
    const render = await Promise.race([renderRevealGif(card), timeout]);
    if (!render?.ok || !render.gifPath) return;
    const attachmentName = `tcg-reveal-${revealSession.session_id}-${revealSession.current_index}.gif`;
    const payload = await buildRevealPayload({
      session: revealSession,
      user,
      setCode,
      rewards: null,
      includeValue: isVerboseTcgMode(),
      renderMedia: false,
    });
    payload.files = [new AttachmentBuilder(render.gifPath, { name: attachmentName })];
    payload.embeds[0].setImage(`attachment://${attachmentName}`);
    await interaction.editReply(payload);
  } catch {
    // Non-blocking enhancement; ignore failures.
  }
}

function paginateRows(allRows = [], page = 1, pageSize = 10) {
  const safePage = Math.max(1, Number(page || 1));
  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const boundedPage = Math.min(safePage, totalPages);
  const start = (boundedPage - 1) * pageSize;
  const rows = allRows.slice(start, start + pageSize);
  return { rows, total, totalPages, page: boundedPage, start };
}

function buildPackQueueButtons(
  view,
  page,
  totalPages,
  {
    showClaimCooldown = false,
    showClaimTop = false,
    showOpenTop = false,
    autoClaimEnabled = false,
  } = {}
) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setCustomId(`tcg_pack:view_claim:${page}`).setLabel('View Claimable').setStyle(view === 'claim' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tcg_pack:view_open:${page}`).setLabel('View Ready To Open').setStyle(view === 'open' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  if (showClaimTop) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`tcg_pack:claim_top:${page}`).setLabel('Claim Next Pack').setStyle(ButtonStyle.Success),
    );
  } else if (showClaimCooldown) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`tcg_pack:claim_cooldown:${page}`).setLabel('Claim Free Pack').setStyle(ButtonStyle.Success),
    );
  } else if (showOpenTop) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`tcg_pack:open_top:${page}`).setLabel('Open Next Pack').setStyle(ButtonStyle.Success),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`tcg_pack:auto_claim_toggle:${page}:${view}`)
      .setLabel(`Auto-Claim: ${autoClaimEnabled ? 'ON' : 'OFF'}`)
      .setStyle(autoClaimEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  return [row, ...buildPagerComponents({
    pageIndex: Math.max(0, Number(page || 1) - 1),
    totalPages: Math.max(1, Number(totalPages || 1)),
    baseCustomId: `tcg_pack:page:${view}`,
  })];
}

function buildPacksHubEmbed(interaction) {
  const unopenedCount = listUnopenedPacks(interaction.user.id, 100).length;
  const availability = getFreePackAvailability(interaction.user.id);
  const overview = getTcgOverview(interaction.user.id);
  return new EmbedBuilder()
    .setTitle('Packs')
    .setDescription(
      `Unopened packs: **${unopenedCount}**\n` +
      `Free pack: **${availability.available ? 'Available now' : `Next free pack <t:${Math.floor(availability.nextAt / 1000)}:R>`}**\n` +
      `Credits: **${overview.wallet?.credits || 0}**`
    );
}

function buildPacksHubButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tcg_hub:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tcg_hub:open').setLabel('Open Next').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('tcg_hub:queue').setLabel('Queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tcg_hub:trade_in').setLabel('Trade In').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function sendOrEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

function tcgEphemeral(category, ctx = null, options = {}) {
  return resolveEphemeralVisibility({
    category,
    isPublic: Boolean(ctx?.isPublic),
    forcePrivate: Boolean(options.forcePrivate),
  });
}

const PAGED_VIEW_TTL_MS = 30 * 60 * 1000;
const pagedViewState = new Map();

function setPagedViewState(messageId, state) {
  if (!messageId) return;
  pagedViewState.set(messageId, {
    ...state,
    expiresAt: Date.now() + PAGED_VIEW_TTL_MS,
  });
}

function getPagedViewState(messageId) {
  const row = pagedViewState.get(messageId);
  if (!row) return null;
  if (Date.now() > Number(row.expiresAt || 0)) {
    pagedViewState.delete(messageId);
    return null;
  }
  return row;
}

async function savePagedStateFromInteraction(interaction, state) {
  try {
    const sent = await interaction.fetchReply();
    if (sent?.id) setPagedViewState(sent.id, state);
  } catch {
    // Best-effort state for pager buttons.
  }
}

async function renderClaimQueue(interaction, { page = 1 } = {}) {
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);
  const all = listClaimablePacks(interaction.user.id, 100);
  const pagination = paginateRows(all, page, 10);
  const availability = getFreePackAvailability(interaction.user.id);
  const userSettings = getTcgUserSettings(interaction.user.id);
  const previewSetCode = pagination.rows[0]?.set_code || '';
  const eventEffects = getEffectiveEventEffects({ setCode: previewSetCode });
  const embed = new EmbedBuilder()
    .setTitle('Pack Claim Queue')
    .setDescription(`Page ${pagination.page}/${pagination.totalPages} • ${pagination.total} claimable packs`)
    .addFields(
      {
        name: 'Free Pack Cooldown',
        value: availability.available
          ? 'Ready now. Press **Claim Free Pack**.'
          : `Available <t:${Math.floor(availability.nextAt / 1000)}:R>`,
        inline: false,
      },
      {
        name: 'Claimable Packs',
        value: pagination.rows.length
          ? pagination.rows.map((row, idx) =>
            `${pagination.start + idx + 1}. ${formatPackDisplayName(row)}`
          ).join('\n')
          : 'No claimable packs.',
        inline: false,
      },
      {
        name: 'Auto-Claim',
        value: userSettings.auto_claim_enabled ? 'Enabled' : 'Disabled',
        inline: false,
      },
      {
        name: 'Active Events',
        value: formatActiveEventLines(eventEffects, { setCode: previewSetCode }).join('\n'),
        inline: false,
      }
    );
  const { pageLabel } = buildPagedEmbed({
    title: 'Pack Claim Queue',
    pages: Array.from({ length: pagination.totalPages }, () => 'page'),
    pageIndex: pagination.page - 1,
  });
  embed.setFooter({ text: pageLabel });
  const topPreview = pagination.rows[0] ? getSetPreviewUrl(pagination.rows[0].set_code) : '';
  if (topPreview) embed.setThumbnail(topPreview);

  const components = buildPackQueueButtons('claim', pagination.page, pagination.totalPages, {
    showClaimCooldown: availability.available,
    showClaimTop: pagination.rows.length > 0,
    autoClaimEnabled: userSettings.auto_claim_enabled,
  });
  warnIfPagedWithoutPager({ totalPages: pagination.totalPages, components, source: 'renderClaimQueue' });
  return sendOrEdit(interaction, {
    content: '',
    embeds: [embed],
    components,
    ephemeral,
  });
}

async function renderOpenQueue(interaction, { page = 1 } = {}) {
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);
  const all = listUnopenedPacks(interaction.user.id, 100);
  const pagination = paginateRows(all, page, 10);
  const availability = getFreePackAvailability(interaction.user.id);
  const userSettings = getTcgUserSettings(interaction.user.id);
  const previewSetCode = pagination.rows[0]?.set_code || '';
  const eventEffects = getEffectiveEventEffects({ setCode: previewSetCode });
  const embed = new EmbedBuilder()
    .setTitle('Ready To Open')
    .setDescription(`Page ${pagination.page}/${pagination.totalPages} • ${pagination.total} unopened packs`)
    .addFields(
      {
        name: 'Next Free Offer',
        value: availability.available
          ? 'A free pack is ready in claim queue.'
          : `<t:${Math.floor(availability.nextAt / 1000)}:R>`,
        inline: false,
      },
      {
        name: 'Unopened Packs',
        value: pagination.rows.length
          ? pagination.rows.map((row, idx) =>
            `${pagination.start + idx + 1}. ${formatPackDisplayName(row)}`
          ).join('\n')
          : 'No unopened packs.',
        inline: false,
      },
      {
        name: 'Auto-Claim',
        value: userSettings.auto_claim_enabled ? 'Enabled' : 'Disabled',
        inline: false,
      },
      {
        name: 'Active Events',
        value: formatActiveEventLines(eventEffects, { setCode: previewSetCode }).join('\n'),
        inline: false,
      }
    );
  const { pageLabel } = buildPagedEmbed({
    title: 'Ready To Open',
    pages: Array.from({ length: pagination.totalPages }, () => 'page'),
    pageIndex: pagination.page - 1,
  });
  embed.setFooter({ text: pageLabel });
  const topPreview = pagination.rows[0] ? getSetPreviewUrl(pagination.rows[0].set_code) : '';
  if (topPreview) embed.setThumbnail(topPreview);

  const components = buildPackQueueButtons('open', pagination.page, pagination.totalPages, {
    showOpenTop: pagination.rows.length > 0,
    autoClaimEnabled: userSettings.auto_claim_enabled,
  });
  warnIfPagedWithoutPager({ totalPages: pagination.totalPages, components, source: 'renderOpenQueue' });
  return sendOrEdit(interaction, {
    content: '',
    embeds: [embed],
    components,
    ephemeral,
  });
}

async function openClaimedPackById(interaction, packId) {
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);
  const pack = getClaimablePack(packId, interaction.user.id);
  if (!pack || pack.status !== 'unopened') {
    await sendOrEdit(interaction, { content: 'Pack not found or already opened.', components: [], ephemeral });
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }
  await requireSetCached(pack.set_code);
  const drop = rollPackDetailed({
    userId: interaction.user.id,
    setCode: pack.set_code,
    productCode: pack.product_code || `${pack.set_code}-default`,
  });
  const opened = openUnopenedPackWithMint({
    idempotencyKey: interaction.id,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    packId: pack.pack_id,
    pulls: drop.pulls,
    profileVersion: drop.profileVersion,
    dropAudit: drop.audit,
    pityTriggered: drop.pityTriggered,
  });
  const revealSession = createRevealSession({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    cards: opened.result.minted,
  });
  const payload = await buildRevealPayload({
    session: revealSession,
    user: interaction.user,
    setCode: pack.set_code,
    rewards: opened.result.rewards,
    includeValue: isVerboseTcgMode(),
    renderMedia: false,
  });
  const previewImage = getSetPreviewUrl(pack.set_code);
  if (previewImage && payload.embeds?.[0]) {
    payload.embeds[0].setThumbnail(previewImage);
  }
  const sent = await interaction.editReply(payload);
  setRevealSessionMessage(revealSession.session_id, sent.id);
  void upgradeRevealMediaAsync({ interaction, revealSession, setCode: pack.set_code, user: interaction.user });
}

async function handleInventory(ctx) {
  const { interaction, targetUser, page, setCode, filter } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (targetUser && !isAdminForCtx(ctx)) {
    await interaction.reply({ content: 'Admin only for viewing other users inventory.', ephemeral });
    return;
  }
  const inv = getInventoryPage({
    userId: targetUser?.id || interaction.user.id,
    page,
    pageSize: 10,
    setCode,
    nameLike: filter,
  });
  const titleUser = targetUser ? `${targetUser.username}` : 'You';
  const duplicateRows = getDuplicateSummaryForUser(targetUser?.id || interaction.user.id, 1);
  const embed = buildInventoryListEmbed({ titleUser, inv, duplicateRows });
  const { pageLabel } = buildPagedEmbed({
    title: 'Your Collection',
    pages: Array.from({ length: inv.totalPages }, () => 'page'),
    pageIndex: inv.page - 1,
  });
  embed.setFooter({ text: pageLabel });
  const components = [];
  const selectRow = buildInventorySelectRow(inv.rows);
  if (selectRow) components.push(selectRow);
  components.push(...buildPagerComponents({
    pageIndex: inv.page - 1,
    totalPages: inv.totalPages,
    baseCustomId: 'tcg_page:inventory',
  }));
  warnIfPagedWithoutPager({ totalPages: inv.totalPages, components, source: 'handleInventory' });
  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral,
  });
  await savePagedStateFromInteraction(interaction, {
    type: 'inventory',
    page: inv.page,
    setCode: setCode || '',
    filter: filter || '',
    targetUserId: targetUser?.id || '',
    ephemeral,
    userId: interaction.user.id,
    ownerLabel: titleUser,
  });
}

async function handleCardView(ctx) {
  const { interaction, csvCards, cardSelection } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  const id = cardSelection || parseCsvIds(csvCards)[0];
  if (!id) {
    await interaction.reply({ content: 'Choose a card from autocomplete, or use advanced `card_instance_ids`.', ephemeral });
    return;
  }
  const card = getCardInstance(id);
  if (!card) {
    await interaction.reply({ content: 'Card instance not found.', ephemeral });
    return;
  }
  const cardMeta = getCardById(card.card_id) || {};
  const estimated = await getCardEstimatedPrice(card.card_id);
  const embed = new EmbedBuilder()
    .setTitle(card.name || 'Card')
    .setDescription(`Set ${resolveSetName(card.set_code)} • ${formatRarity(card.rarity)}`)
    .addFields(
      { name: 'Estimated', value: formatEstimatedLine(estimated), inline: false },
      { name: 'State', value: card.state || 'owned', inline: true }
    );
  const image = cardMeta.image_large || cardMeta.image_small || '';
  if (image) embed.setImage(image);
  await interaction.reply({ embeds: [embed], ephemeral });
}

async function handleCollectionStats(ctx) {
  const { interaction, targetUser } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.SHAREABLE_STATS, ctx);
  if (targetUser && !isAdminForCtx(ctx)) {
    await interaction.reply({ content: 'Admin only for viewing other users stats.', ephemeral });
    return;
  }
  const overview = getTcgOverview(targetUser?.id || interaction.user.id);
  const eventSummary = formatActiveEventLines(overview.events || {}).join(' | ');
  await interaction.reply({
    content:
      `Cards: ${overview.inventoryCount}\n` +
      `Credits: ${overview.wallet.credits}\n` +
      `Opened packs: ${overview.wallet.opened_count}\n` +
      `Streak: ${overview.wallet.streak_days}\n` +
      `Free pack: ${overview.cooldown.available ? 'ready' : `<t:${Math.floor(overview.cooldown.nextAt / 1000)}:R>`}\n` +
      `Events: ${eventSummary}`,
    ephemeral,
  });
}

async function handleTradeOffer(ctx) {
  const { interaction, targetUser, csvCards, csvRequestCards, credits, requestCredits } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Trade offers are guild-only.', ephemeral });
    return;
  }
  if (!targetUser) {
    await interaction.reply({ content: 'Provide `target_user`.', ephemeral });
    return;
  }
  const offerCards = parseCsvIds(csvCards);
  const reqCards = parseCsvIds(csvRequestCards);
  if (!offerCards.length) {
    await interaction.reply({ content: 'Provide offered `card_instance_ids`.', ephemeral });
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
    requestCredits: Math.max(0, requestCredits),
  });
  await interaction.reply({
    content: `${interaction.user} offered a trade to ${targetUser}.\n${summarizeTrade(trade)}`,
    components: buildTradeButtons(trade.trade_id),
    ephemeral,
  });
}

async function handleTradeAccept(ctx) {
  const { interaction, tradeId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  if (!tradeId) {
    await interaction.reply({ content: 'Provide `trade_id`.', ephemeral });
    return;
  }
  const settled = acceptOffer(tradeId, interaction.user.id);
  await interaction.reply({ content: `Trade settled.\n${summarizeTrade(settled)}`, ephemeral });
}

async function handleTradeReject(ctx) {
  const { interaction, tradeId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  if (!tradeId) {
    await interaction.reply({ content: 'Provide `trade_id`.', ephemeral });
    return;
  }
  const result = rejectOffer(tradeId, interaction.user.id);
  await interaction.reply({ content: `Trade rejected.\n${summarizeTrade(result)}`, ephemeral });
}

async function handleTradeCancel(ctx) {
  const { interaction, tradeId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  if (!tradeId) {
    await interaction.reply({ content: 'Provide `trade_id`.', ephemeral });
    return;
  }
  const result = cancelOffer(tradeId, interaction.user.id);
  await interaction.reply({ content: `Trade cancelled.\n${summarizeTrade(result)}`, ephemeral });
}

async function handleTradeView(ctx) {
  const { interaction } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE, ctx);
  const trades = listTradesForUser(interaction.user.id);
  if (!trades.length) {
    await interaction.reply({ content: 'No trades found.', ephemeral });
    return;
  }
  const lines = trades.slice(0, 10).map((t) =>
    `\`${t.trade_id}\` ${t.status} <@${t.offered_by_user_id}> -> <@${t.offered_to_user_id}>`
  );
  await interaction.reply({ content: lines.join('\n'), ephemeral });
}

async function handleMarketValue(ctx) {
  const { interaction, csvCards, cardSelection } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  const rawId = cardSelection || parseCsvIds(csvCards)[0];
  if (!rawId) {
    await interaction.reply({ content: 'Provide `card` (autocomplete) or `card_instance_ids`.', ephemeral });
    return;
  }
  const instance = getCardInstance(rawId);
  const card = instance || getCardById(rawId);
  if (!card) {
    await interaction.reply({ content: 'Card not found.', ephemeral });
    return;
  }
  const estimated = await getCardEstimatedPrice(card.card_id || card.cardId || '');
  const name = card.name || card.card_id;
  await interaction.reply({ content: `${name} • ${formatEstimatedLine(estimated)}`, ephemeral });
}

async function handleMarketBrowse(ctx) {
  const { interaction, page, setCode, filter } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.SHAREABLE_STATS, ctx);
  const result = browseMarketCatalog({
    page,
    pageSize: 10,
    setCode,
    nameLike: filter,
  });
  const embed = new EmbedBuilder()
    .setTitle('Singles Market')
    .setDescription(`Page ${result.page}/${result.totalPages} • ${result.total} cards listed`)
    .addFields({
      name: 'Listings',
      value: result.rows.length
        ? result.rows.map((row, idx) =>
          `${idx + 1}. ${row.name} (${resolveSetName(row.set_code)}) • buy ${row.buy_price_credits} • sell ${row.sell_price_credits}`
        ).join('\n')
        : 'No listings matched your filter.',
      inline: false,
    });
  const { pageLabel } = buildPagedEmbed({
    title: 'Singles Market',
    pages: Array.from({ length: result.totalPages }, () => 'page'),
    pageIndex: result.page - 1,
  });
  embed.setFooter({ text: pageLabel });
  const firstImage = result.rows[0]?.image_small || result.rows[0]?.image_large || '';
  if (firstImage) embed.setThumbnail(firstImage);
  const components = buildPagerComponents({
    pageIndex: result.page - 1,
    totalPages: result.totalPages,
    baseCustomId: 'tcg_page:market_browse',
  });
  warnIfPagedWithoutPager({ totalPages: result.totalPages, components, source: 'handleMarketBrowse' });
  await interaction.reply({ embeds: [embed], components, ephemeral });
  await savePagedStateFromInteraction(interaction, {
    type: 'market_browse',
    page: result.page,
    setCode: setCode || '',
    filter: filter || '',
    ephemeral,
    userId: interaction.user.id,
  });
}

async function handleMarketQuoteBuy(ctx) {
  const { interaction, cardId, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (!cardId) {
    await interaction.reply({ content: 'Provide `card_id`.', ephemeral });
    return;
  }
  const quote = getBuyQuote(cardId, quantity);
  await interaction.reply({
    content: `Buy quote: ${quote.quantity}x ${quote.cardName} at ${quote.unitPriceCredits} each = ${quote.totalCredits} credits.`,
    ephemeral,
  });
}

async function handleMarketBuy(ctx) {
  const { interaction, cardId, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (!cardId) {
    await interaction.reply({ content: 'Provide `card_id`.', ephemeral });
    return;
  }
  const purchase = executeMarketBuy({
    userId: interaction.user.id,
    cardId,
    quantity,
    idempotencyKey: interaction.id,
  });
  await interaction.reply({
    content: `Bought ${purchase.quantity}x ${purchase.cardName} for ${purchase.totalCredits} credits.`,
    ephemeral,
  });
}

async function handleMarketQuoteSell(ctx) {
  const { interaction, csvCards, cardSelection, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (cardSelection) {
    const resolved = resolveOwnedInstanceIdsForSelection(interaction.user.id, cardSelection, quantity || 1);
    const quote = getSellQuoteForInstances(interaction.user.id, resolved.instanceIds);
    await interaction.reply({
      content:
        `Sell quote: ${quote.quantity}x ${resolved.cardName} for ${quote.totalCredits} credits total.\n` +
        `(You own ${resolved.availableCount} copy/copies.)`,
      ephemeral,
    });
    return;
  }
  const ids = parseCsvIds(csvCards);
  if (!ids.length) {
    await interaction.reply({ content: 'Provide `card` (autocomplete) or `card_instance_ids`.', ephemeral });
    return;
  }
  const quote = getSellQuoteForInstances(interaction.user.id, ids);
  await interaction.reply({
    content: `Sell quote: ${quote.quantity} card(s) for ${quote.totalCredits} credits total.`,
    ephemeral,
  });
}

async function handleMarketSell(ctx) {
  const { interaction, csvCards, cardSelection, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (cardSelection) {
    const resolved = resolveOwnedInstanceIdsForSelection(interaction.user.id, cardSelection, quantity || 1);
    const sold = executeMarketSellInstances({ userId: interaction.user.id, instanceIds: resolved.instanceIds });
    await interaction.reply({
      content:
        `Sold ${sold.quantity}x ${resolved.cardName} for ${sold.totalCredits} credits.\n` +
        `(You had ${resolved.availableCount} copy/copies.)`,
      ephemeral,
    });
    return;
  }
  const ids = parseCsvIds(csvCards);
  if (!ids.length) {
    await interaction.reply({ content: 'Provide `card` (autocomplete) or `card_instance_ids`.', ephemeral });
    return;
  }
  const sold = executeMarketSellInstances({ userId: interaction.user.id, instanceIds: ids });
  await interaction.reply({
    content: `Sold ${sold.quantity} card(s) for ${sold.totalCredits} credits.`,
    ephemeral,
  });
}

async function handleMarketSellDuplicates(ctx) {
  const { interaction, keepPerCard, maxTier, credits, confirm } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.PRIVATE_INVENTORY, ctx);
  if (String(confirm || '').toLowerCase() !== 'yes') {
    const duplicates = getDuplicateSummaryForUser(interaction.user.id, keepPerCard);
    const preview = duplicates.slice(0, 10).map((row) =>
      `${row.name}: ${row.owned_count} owned`
    ).join('\n');
    await interaction.reply({
      content:
        `Preview only. Use \`confirm:yes\` to execute.\n` +
        `${preview || 'No duplicates found.'}`,
      ephemeral,
    });
    return;
  }
  const sold = executeMarketSellDuplicates({
    userId: interaction.user.id,
    keepPerCard,
    maxTier,
    maxUnitValue: Math.max(0, Number(credits || 999999)),
  });
  await interaction.reply({
    content: `Auto-sold ${sold.quantity} duplicate card(s) for ${sold.totalCredits} credits.`,
    ephemeral,
  });
}

function requireAdmin(ctx) {
  if (!hasInteractionAdminAccess(ctx.interaction, ctx.superAdminId)) {
    throw new Error('Admin only.');
  }
}

async function handleAdminGrantPack(ctx) {
  const { interaction, targetUser, setCode, productCode } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (!targetUser || !setCode) {
    await interaction.reply({ content: 'Provide `target_user` and `set_code`.', ephemeral });
    return;
  }
  await requireSetCached(setCode);
  const pulls = rollPack({ setCode, productCode: productCode || `${setCode}-default` });
  const minted = grantAdminCards(interaction.user.id, targetUser.id, pulls.map((p) => p.card_id), 'admin_pack_grant');
  await interaction.reply({ content: `Granted ${minted.length} cards to ${targetUser}.`, ephemeral });
}

async function handleAdminGrantSealedPack(ctx) {
  const { interaction, targetUser, setCode, productCode, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (!targetUser || !setCode) {
    await interaction.reply({ content: 'Provide `target_user` and `set_code`.', ephemeral });
    return;
  }
  await requireSetCached(setCode);
  const granted = grantAdminSealedPacks(interaction.user.id, targetUser.id, {
    setCode,
    productCode: productCode || `${setCode}-default`,
    quantity: Math.max(1, Math.min(100, Number(quantity || 1))),
  });
  const preview = granted.slice(0, 5).map((p) => `\`${p.pack_id}\``).join(', ');
  await interaction.reply({
    content:
      `Granted ${granted.length} unopened pack(s) to ${targetUser}.\n` +
      (preview ? `Pack IDs: ${preview}${granted.length > 5 ? ', ...' : ''}` : ''),
    ephemeral,
  });
}

async function handleAdminGrantCredits(ctx) {
  const { interaction, targetUser, credits } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (!targetUser || !credits) {
    await interaction.reply({ content: 'Provide `target_user` and non-zero `credits`.', ephemeral });
    return;
  }
  const wallet = grantAdminCredits(interaction.user.id, targetUser.id, credits, 'admin_grant_credits');
  await interaction.reply({ content: `Updated ${targetUser} credits: ${wallet.credits}.`, ephemeral });
}

async function handleAdminSetMultiplier(ctx) {
  const { interaction, key, value } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (!key || !value) {
    await interaction.reply({ content: 'Use `key` and `value` (e.g. key=credit_multiplier, value=1.5).', ephemeral });
    return;
  }
  setAdminMultiplier(interaction.user.id, key, value);
  await interaction.reply({ content: `Multiplier updated: ${key}=${value}.`, ephemeral });
}

async function handleAdminTradeLock(ctx) {
  const { interaction, filter } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const enabled = String(filter || '').toLowerCase() === 'on' || String(filter || '').toLowerCase() === 'true';
  setTradeLocked(interaction.user.id, enabled);
  await interaction.reply({ content: `Trading lock is now ${enabled ? 'ON' : 'OFF'}.`, ephemeral });
}

async function handleAdminAudit(ctx) {
  const { interaction, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const rows = listAdminEvents(Math.max(1, Math.min(50, quantity || 20)));
  const lines = rows.map((r) => `\`${r.event_id}\` ${r.action} by <@${r.admin_user_id}> at <t:${Math.floor(r.created_at / 1000)}:R>`);
  await interaction.reply({ content: lines.join('\n') || 'No admin events.', ephemeral });
}

async function handleAdminRollbackTrade(ctx) {
  const { interaction, tradeId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (!tradeId) {
    await interaction.reply({ content: 'Provide `trade_id`.', ephemeral });
    return;
  }
  const rolled = rollbackSettledTrade(interaction.user.id, tradeId);
  await interaction.reply({ content: `Trade rolled back.\n${summarizeTrade(rolled)}`, ephemeral });
}

function formatEventTime(ts) {
  if (!Number.isFinite(Number(ts)) || Number(ts) <= 0) return 'n/a';
  return `<t:${Math.floor(Number(ts) / 1000)}:F> (<t:${Math.floor(Number(ts) / 1000)}:R>)`;
}

async function handleAdminEventCreate(ctx) {
  const {
    interaction,
    eventName,
    eventEffectType,
    eventEffectValue,
    setCode,
    startUnix,
    endUnix,
    eventEnabled,
  } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const created = createLiveEvent(interaction.user.id, {
    name: eventName,
    effectType: eventEffectType,
    effectValue: eventEffectValue,
    setScope: setCode || '',
    startAt: Number(startUnix || 0) * 1000,
    endAt: Number(endUnix || 0) * 1000,
    enabled: eventEnabled !== false,
  });
  await interaction.reply({
    content:
      `Created event \`${created.event_id}\` (${created.name}).\n` +
      `Effect: ${created.effect_type}=${created.effect_value}\n` +
      `Scope: ${created.set_scope ? created.set_scope.toUpperCase() : 'GLOBAL'}\n` +
      `Status: ${created.status}\n` +
      `Start: ${formatEventTime(created.start_at)}\n` +
      `End: ${formatEventTime(created.end_at)}`,
    ephemeral,
  });
}

async function handleAdminEventList(ctx) {
  const { interaction, eventStatus, quantity } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const rows = listLiveEvents({ status: eventStatus || 'all', limit: Math.max(1, Math.min(100, quantity || 20)) });
  const lines = rows.map((row) =>
    `\`${row.event_id}\` ${row.name} • ${row.effect_type}=${row.effect_value} • ${row.status} • ${row.set_scope ? row.set_scope.toUpperCase() : 'GLOBAL'} • <t:${Math.floor(row.end_at / 1000)}:R>`
  );
  await interaction.reply({ content: lines.join('\n') || 'No live events.', ephemeral });
}

async function handleAdminEventEnable(ctx) {
  const { interaction, eventId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const updated = setLiveEventStatus(interaction.user.id, eventId, 'active');
  await interaction.reply({
    content: `Event enabled: \`${updated.event_id}\` (${updated.name}) now ${updated.status}.`,
    ephemeral,
  });
}

async function handleAdminEventDisable(ctx) {
  const { interaction, eventId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  const updated = setLiveEventStatus(interaction.user.id, eventId, 'disabled');
  await interaction.reply({
    content: `Event disabled: \`${updated.event_id}\` (${updated.name}).`,
    ephemeral,
  });
}

async function handleAdminEventDelete(ctx) {
  const { interaction, eventId } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  deleteLiveEvent(interaction.user.id, eventId);
  await interaction.reply({ content: `Deleted event \`${eventId}\`.`, ephemeral });
}

async function handleAdminEventNow(ctx) {
  const { interaction, eventId, eventMode } = ctx;
  const ephemeral = tcgEphemeral(VisibilityCategory.ADMIN_CONTROL, ctx);
  requireAdmin(ctx);
  if (eventMode === 'start_now') {
    setLiveEventNow(interaction.user.id, eventId, 'start_now');
    const activated = activateDueLiveEvents(interaction.user.id);
    await interaction.reply({
      content: `Start-now applied for \`${eventId}\`. Activated events in this tick: ${activated}.`,
      ephemeral,
    });
    return;
  }
  if (eventMode === 'stop_now') {
    setLiveEventNow(interaction.user.id, eventId, 'stop_now');
    const expired = expireEndedLiveEvents(interaction.user.id);
    await interaction.reply({
      content: `Stop-now applied for \`${eventId}\`. Auto-expired events in this tick: ${expired}.`,
      ephemeral,
    });
    return;
  }
  await interaction.reply({ content: 'Use mode: start_now or stop_now.', ephemeral });
}

function safeOption(interaction, kind, name, fallback) {
  try {
    const value = interaction.options?.[kind]?.(name);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function buildCommandCtx(interaction, superAdminId) {
  return {
    interaction,
    superAdminId,
    setCode: normalizeSetCode(
      safeOption(interaction, 'getString', 'set_code', '') ||
      safeOption(interaction, 'getString', 'type', '')
    ),
    productCode: safeOption(interaction, 'getString', 'product_code', ''),
    quantity: safeOption(interaction, 'getInteger', 'quantity', 1) || 1,
    targetUser: safeOption(interaction, 'getUser', 'target_user', null),
    csvCards: safeOption(interaction, 'getString', 'card_instance_ids', ''),
    csvRequestCards: safeOption(interaction, 'getString', 'request_instance_ids', ''),
    credits: safeOption(interaction, 'getInteger', 'credits', 0) || 0,
    requestCredits: safeOption(interaction, 'getInteger', 'request_credits', 0) || 0,
    tradeId: safeOption(interaction, 'getString', 'trade_id', ''),
    packId: safeOption(interaction, 'getString', 'pack_id', ''),
    cardId: safeOption(interaction, 'getString', 'card_id', ''),
    cardSelection: safeOption(interaction, 'getString', 'card', ''),
    packSelection: safeOption(interaction, 'getString', 'pack', ''),
    page: safeOption(interaction, 'getInteger', 'page', 1) || 1,
    filter: safeOption(interaction, 'getString', 'filter', ''),
    key: safeOption(interaction, 'getString', 'key', '') || safeOption(interaction, 'getString', 'filter', ''),
    value: safeOption(interaction, 'getString', 'value', '') || safeOption(interaction, 'getString', 'set_code', ''),
    eventId: safeOption(interaction, 'getString', 'event_id', ''),
    eventName: safeOption(interaction, 'getString', 'name', ''),
    eventEffectType: safeOption(interaction, 'getString', 'effect_type', ''),
    eventEffectValue: safeOption(interaction, 'getString', 'value', ''),
    eventStatus: safeOption(interaction, 'getString', 'status', 'all') || 'all',
    eventEnabled: safeOption(interaction, 'getBoolean', 'enabled', null),
    eventMode: safeOption(interaction, 'getString', 'mode', ''),
    startUnix: safeOption(interaction, 'getInteger', 'start_unix', 0) || 0,
    endUnix: safeOption(interaction, 'getInteger', 'end_unix', 0) || 0,
    isPublic: safeOption(interaction, 'getBoolean', 'public', false) || false,
    keepPerCard: safeOption(interaction, 'getInteger', 'keep_per_card', 2) || 2,
    maxTier: safeOption(interaction, 'getInteger', 'max_tier', 3) || 3,
    confirm: safeOption(interaction, 'getString', 'confirm', ''),
    defaultSetCode: normalizeSetCode(process.env.TCG_DEFAULT_SET_CODE || 'sv1') || 'sv1',
  };
}

async function safeExecuteTcg(interaction, run, label) {
  try {
    await run();
  } catch (err) {
    console.error(`TCG command error (${label}):`, {
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      error: err?.message || String(err),
    });
    const message = err.message === 'Admin only.' ? 'Admin only.' : `TCG command failed: ${err.message}`;
    const isAdminError = err.message === 'Admin only.';
    const category = isAdminError ? VisibilityCategory.ADMIN_CONTROL : VisibilityCategory.HIGH_NOISE;
    const ephemeral = tcgEphemeral(category);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral });
    } else {
      await interaction.reply({ content: message, ephemeral });
    }
  }
}

export async function executeClaimPackCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => {
    const ctx = buildCommandCtx(interaction, superAdminId);
    await renderClaimQueue(interaction, { page: ctx.page });
  }, 'claim-pack');
}

export async function executeOpenPackCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => {
    const ctx = buildCommandCtx(interaction, superAdminId);
    if (ctx.packId) {
      await openClaimedPackById(interaction, ctx.packId);
      return;
    }
    await renderOpenQueue(interaction, { page: ctx.page });
  }, 'open-pack');
}

export async function executeViewUnopenedPacksCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => {
    const ctx = buildCommandCtx(interaction, superAdminId);
    await renderOpenQueue(interaction, { page: ctx.page });
  }, 'view-unopened-packs');
}

export async function executeViewPackCompletionCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => {
    const ctx = buildCommandCtx(interaction, superAdminId);
    const ephemeral = tcgEphemeral(VisibilityCategory.SHAREABLE_STATS, ctx);
    const requestedSetCode = normalizeSetCode(ctx.packSelection || ctx.setCode || '');
    if (!requestedSetCode) {
      await interaction.reply({ content: 'Provide a pack/set via `pack`.', ephemeral });
      return;
    }

    try {
      await requireSetCached(requestedSetCode);
    } catch (err) {
      const setErr = parseSetSyncError(err);
      if (isTransientSetSyncError(err) && getCardsBySet(requestedSetCode).length > 0) {
        console.warn(`Using cached set data for ${requestedSetCode} due to API outage:`, err.message);
      } else if (setErr) {
        await interaction.reply({ content: setErr, ephemeral });
        return;
      } else {
        throw err;
      }
    }

    const completion = getSetCompletionForUser(interaction.user.id, requestedSetCode);
    if (!completion.total) {
      await interaction.reply({
        content: `No cards cached for set \`${requestedSetCode}\` yet. Try opening/claiming from that set first.`,
        ephemeral,
      });
      return;
    }

    const ui = buildCompletionEmbedData(completion);
    const embed = new EmbedBuilder()
      .setTitle(ui.title)
      .setDescription(ui.description)
      .addFields(ui.fields);
    if (ui.featuredImageUrl) {
      embed.setImage(ui.featuredImageUrl);
    }
    const preview = getSetPreviewUrl(completion.setCode);
    if (preview) embed.setThumbnail(preview);
    await interaction.reply({ embeds: [embed], ephemeral });
  }, 'view-pack-completion');
}

export async function executeAutoClaimPackCommand(interaction) {
  await safeExecuteTcg(interaction, async () => {
    const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);
    const mode = String(safeOption(interaction, 'getString', 'mode', 'status') || 'status').toLowerCase();
    if (mode === 'status') {
      const settings = getTcgUserSettings(interaction.user.id);
      await interaction.reply({
        content: `Auto-claim is ${settings.auto_claim_enabled ? 'ON' : 'OFF'}.`,
        ephemeral,
      });
      return;
    }
    if (mode === 'on' || mode === 'off') {
      const updated = setAutoClaimEnabled(interaction.user.id, mode === 'on');
      await interaction.reply({
        content: `Auto-claim is now ${updated.auto_claim_enabled ? 'ON' : 'OFF'}.`,
        ephemeral,
      });
      return;
    }
    await interaction.reply({ content: 'Use mode: on, off, or status.', ephemeral });
  }, 'auto-claim-pack');
}

export async function executeInventoryCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleInventory(buildCommandCtx(interaction, superAdminId)), 'inventory');
}
export async function executeCardViewCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleCardView(buildCommandCtx(interaction, superAdminId)), 'card-view');
}
export async function executeCollectionStatsCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleCollectionStats(buildCommandCtx(interaction, superAdminId)), 'collection-stats');
}
export async function executeTradeOfferCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleTradeOffer(buildCommandCtx(interaction, superAdminId)), 'trade-offer');
}
export async function executeTradeAcceptCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleTradeAccept(buildCommandCtx(interaction, superAdminId)), 'trade-accept');
}
export async function executeTradeRejectCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleTradeReject(buildCommandCtx(interaction, superAdminId)), 'trade-reject');
}
export async function executeTradeCancelCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleTradeCancel(buildCommandCtx(interaction, superAdminId)), 'trade-cancel');
}
export async function executeTradeViewCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleTradeView(buildCommandCtx(interaction, superAdminId)), 'trade-view');
}
export async function executeMarketValueCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketValue(buildCommandCtx(interaction, superAdminId)), 'market-value');
}
export async function executeMarketBrowseCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketBrowse(buildCommandCtx(interaction, superAdminId)), 'market-browse');
}
export async function executeMarketQuoteBuyCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketQuoteBuy(buildCommandCtx(interaction, superAdminId)), 'market-quote-buy');
}
export async function executeMarketBuyCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketBuy(buildCommandCtx(interaction, superAdminId)), 'market-buy');
}
export async function executeMarketQuoteSellCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketQuoteSell(buildCommandCtx(interaction, superAdminId)), 'market-quote-sell');
}
export async function executeMarketSellCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketSell(buildCommandCtx(interaction, superAdminId)), 'market-sell');
}
export async function executeMarketSellDuplicatesCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleMarketSellDuplicates(buildCommandCtx(interaction, superAdminId)), 'market-sell-duplicates');
}
export async function executeAdminGrantPackCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminGrantSealedPack(buildCommandCtx(interaction, superAdminId)), 'admin-grant-pack');
}
export async function executeAdminGrantCreditsCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminGrantCredits(buildCommandCtx(interaction, superAdminId)), 'admin-grant-credits');
}
export async function executeAdminSetMultiplierCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminSetMultiplier(buildCommandCtx(interaction, superAdminId)), 'admin-set-multiplier');
}
export async function executeAdminTradeLockCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminTradeLock(buildCommandCtx(interaction, superAdminId)), 'admin-trade-lock');
}
export async function executeAdminEventCreateCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventCreate(buildCommandCtx(interaction, superAdminId)), 'admin-event-create');
}
export async function executeAdminEventListCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventList(buildCommandCtx(interaction, superAdminId)), 'admin-event-list');
}
export async function executeAdminEventEnableCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventEnable(buildCommandCtx(interaction, superAdminId)), 'admin-event-enable');
}
export async function executeAdminEventDisableCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventDisable(buildCommandCtx(interaction, superAdminId)), 'admin-event-disable');
}
export async function executeAdminEventDeleteCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventDelete(buildCommandCtx(interaction, superAdminId)), 'admin-event-delete');
}
export async function executeAdminEventNowCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminEventNow(buildCommandCtx(interaction, superAdminId)), 'admin-event-now');
}
export async function executeAdminAuditCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminAudit(buildCommandCtx(interaction, superAdminId)), 'admin-audit');
}
export async function executeAdminRollbackTradeCommand(interaction, { superAdminId } = {}) {
  await safeExecuteTcg(interaction, async () => handleAdminRollbackTrade(buildCommandCtx(interaction, superAdminId)), 'admin-rollback-trade');
}

export async function executePacksCommand(interaction) {
  await safeExecuteTcg(interaction, async () => {
    const embed = buildPacksHubEmbed(interaction);
    await interaction.reply({
      embeds: [embed],
      components: buildPacksHubButtons(),
      ephemeral: false,
    });
  }, 'packs');
}

export async function executeTcgAutocomplete(interaction) {
  const commandName = String(interaction.commandName || '');
  const focused = interaction.options.getFocused(true);
  if (!focused) return false;
  const query = String(focused.value || '');

  if (focused.name === 'card') {
    if (commandName === 'market-sell' || commandName === 'market-quote-sell' || commandName === 'market-value') {
      const choices = getOwnedCardAutocompleteChoices(interaction.user.id, query, 25);
      await interaction.respond(choices.slice(0, 25));
      return true;
    }
    if (commandName === 'card-view') {
      const choices = getOwnedInstanceAutocompleteChoices(interaction.user.id, query, 25);
      await interaction.respond(choices.slice(0, 25));
      return true;
    }
  }

  if (focused.name === 'pack_id' && commandName === 'open-pack') {
    const choices = getUnopenedPackAutocompleteChoices(interaction.user.id, query, 25);
    await interaction.respond(choices.slice(0, 25));
    return true;
  }

  if (focused.name === 'pack' && commandName === 'view-pack-completion') {
    const choices = getSetAutocompleteChoices(query, 25);
    await interaction.respond(choices.slice(0, 25));
    return true;
  }

  if (focused.name === 'trade_id') {
    if (commandName === 'trade-accept' || commandName === 'trade-reject' || commandName === 'trade-cancel') {
      const choices = getTradeAutocompleteChoicesForUser(interaction.user.id, query, 25);
      await interaction.respond(choices.slice(0, 25));
      return true;
    }
    if (commandName === 'admin-rollback-trade') {
      const choices = getTradeAutocompleteChoicesByStatus('settled', query, 25);
      await interaction.respond(choices.slice(0, 25));
      return true;
    }
  }
  if (focused.name === 'event_id' && commandName.startsWith('admin-event-')) {
    const choices = getLiveEventAutocompleteChoices(query, 25);
    await interaction.respond(choices.slice(0, 25));
    return true;
  }
  return false;
}

export async function executeTcgPageButton(interaction, { superAdminId } = {}) {
  const [prefix, scope, direction, rawPageIndex] = String(interaction.customId || '').split(':');
  if (prefix !== 'tcg_page') return false;
  const delta = direction === 'next' ? 1 : -1;
  const currentPage = Math.max(1, Number(rawPageIndex || 0) + 1);
  const nextPage = Math.max(1, currentPage + delta);
  const state = getPagedViewState(interaction.message?.id);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Pagination state expired. Run the command again.', ephemeral: true });
    return true;
  }

  if (scope === 'inventory' && state.type === 'inventory') {
    const inv = getInventoryPage({
      userId: state.targetUserId || interaction.user.id,
      page: nextPage,
      pageSize: 10,
      setCode: state.setCode || '',
      nameLike: state.filter || '',
    });
    const titleUser = state.ownerLabel || (state.targetUserId ? `<@${state.targetUserId}>` : 'You');
    const duplicateRows = getDuplicateSummaryForUser(state.targetUserId || interaction.user.id, 1);
    const embed = buildInventoryListEmbed({ titleUser, inv, duplicateRows });
    const invPage = buildPagedEmbed({
      title: 'Your Collection',
      pages: Array.from({ length: inv.totalPages }, () => 'page'),
      pageIndex: inv.page - 1,
    });
    embed.setFooter({ text: invPage.pageLabel });
    const components = [];
    const selectRow = buildInventorySelectRow(inv.rows);
    if (selectRow) components.push(selectRow);
    components.push(...buildPagerComponents({
      pageIndex: inv.page - 1,
      totalPages: inv.totalPages,
      baseCustomId: 'tcg_page:inventory',
    }));
    await interaction.update({ embeds: [embed], components, content: '' });
    setPagedViewState(interaction.message?.id, { ...state, page: inv.page });
    return true;
  }

  if (scope === 'market_browse' && state.type === 'market_browse') {
    const result = browseMarketCatalog({
      page: nextPage,
      pageSize: 10,
      setCode: state.setCode || '',
      nameLike: state.filter || '',
    });
    const embed = new EmbedBuilder()
      .setTitle('Singles Market')
      .setDescription(`Page ${result.page}/${result.totalPages} • ${result.total} cards listed`)
      .addFields({
        name: 'Listings',
        value: result.rows.length
          ? result.rows.map((row, idx) =>
            `${idx + 1}. ${row.name} (${resolveSetName(row.set_code)}) • buy ${row.buy_price_credits} • sell ${row.sell_price_credits}`
          ).join('\n')
          : 'No listings matched your filter.',
        inline: false,
      });
    const marketPage = buildPagedEmbed({
      title: 'Singles Market',
      pages: Array.from({ length: result.totalPages }, () => 'page'),
      pageIndex: result.page - 1,
    });
    embed.setFooter({ text: marketPage.pageLabel });
    const firstImage = result.rows[0]?.image_small || result.rows[0]?.image_large || '';
    if (firstImage) embed.setThumbnail(firstImage);
    const components = buildPagerComponents({
      pageIndex: result.page - 1,
      totalPages: result.totalPages,
      baseCustomId: 'tcg_page:market_browse',
    });
    await interaction.update({ embeds: [embed], components, content: '' });
    setPagedViewState(interaction.message?.id, { ...state, page: result.page });
    return true;
  }

  await interaction.reply({ content: 'Unknown pager view.', ephemeral: true });
  return true;
}

export async function executeTcgHubButton(interaction) {
  const [prefix, action] = String(interaction.customId || '').split(':');
  if (prefix !== 'tcg_hub') return false;

  try {
    if (action === 'queue') {
      await interaction.deferUpdate();
      await renderOpenQueue(interaction, { page: 1 });
      return true;
    }
    if (action === 'trade_in') {
      const result = executeTradeInDuplicates(interaction.user.id);
      const breakdownLines = result.breakdown.length
        ? result.breakdown.map((row) => `Tier ${row.tier}: ${row.burned} card(s) -> ${row.credits} credits`).join('\n')
        : 'No duplicate cards found.';
      await interaction.update({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setTitle('Trade In')
            .setDescription(
              `Traded in **${result.burnedCount}** duplicate card(s).\n` +
              `Credits gained: **${result.totalCredits}**\n` +
              `New balance: **${result.walletCredits}**`
            )
            .addFields({
              name: 'Breakdown',
              value: breakdownLines,
              inline: false,
            }),
        ],
        components: buildPacksHubButtons(),
      });
      return true;
    }
    if (action === 'claim') {
      const top = listClaimablePacks(interaction.user.id, 1)[0];
      if (top) {
        claimPack(top.pack_id, interaction.user.id);
      } else {
        try {
          claimCooldownPack(interaction.user.id);
        } catch {
          // no-op: hub will show current state.
        }
      }
      await interaction.update({
        content: '',
        embeds: [buildPacksHubEmbed(interaction)],
        components: buildPacksHubButtons(),
      });
      return true;
    }
    if (action === 'open') {
      const top = listUnopenedPacks(interaction.user.id, 1)[0];
      if (!top) {
        await interaction.update({
          content: '',
          embeds: [buildPacksHubEmbed(interaction)],
          components: buildPacksHubButtons(),
        });
        return true;
      }
      await interaction.deferUpdate();
      await openClaimedPackById(interaction, top.pack_id);
      return true;
    }
  } catch (err) {
    await interaction.reply({ content: `Hub action failed: ${err.message}`, ephemeral: true });
    return true;
  }

  return false;
}

export async function executeTcgInventoryComponent(interaction) {
  const parts = String(interaction.customId || '').split(':');
  const [prefix, action] = parts;
  if (prefix !== 'tcg_inv') return false;

  const state = getPagedViewState(interaction.message?.id);
  if (!state || state.type !== 'inventory' || state.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Inventory view expired. Run `/inventory` again.', ephemeral: true });
    return true;
  }

  try {
    if (action === 'select') {
      const selectedId = interaction.values?.[0] || '';
      const inv = getInventoryPage({
        userId: state.targetUserId || interaction.user.id,
        page: state.page || 1,
        pageSize: 10,
        setCode: state.setCode || '',
        nameLike: state.filter || '',
      });
      if (!inv.rows.some((row) => row.instance_id === selectedId)) {
        await interaction.reply({ content: 'That card is no longer on this page. Refresh `/inventory`.', ephemeral: true });
        return true;
      }
      const cardEmbed = await buildInventoryCardEmbed(selectedId);
      if (!cardEmbed) {
        await interaction.reply({ content: 'Card not found.', ephemeral: true });
        return true;
      }
      const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tcg_inv:back')
          .setLabel('Back to list')
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.update({ content: '', embeds: [cardEmbed], components: [back] });
      return true;
    }

    if (action === 'back') {
      const inv = getInventoryPage({
        userId: state.targetUserId || interaction.user.id,
        page: state.page || 1,
        pageSize: 10,
        setCode: state.setCode || '',
        nameLike: state.filter || '',
      });
      const duplicateRows = getDuplicateSummaryForUser(state.targetUserId || interaction.user.id, 1);
      const titleUser = state.ownerLabel || (state.targetUserId ? `<@${state.targetUserId}>` : 'You');
      const embed = buildInventoryListEmbed({ titleUser, inv, duplicateRows });
      const invPage = buildPagedEmbed({
        title: 'Your Collection',
        pages: Array.from({ length: inv.totalPages }, () => 'page'),
        pageIndex: inv.page - 1,
      });
      embed.setFooter({ text: invPage.pageLabel });
      const components = [];
      const selectRow = buildInventorySelectRow(inv.rows);
      if (selectRow) components.push(selectRow);
      components.push(...buildPagerComponents({
        pageIndex: inv.page - 1,
        totalPages: inv.totalPages,
        baseCustomId: 'tcg_page:inventory',
      }));
      await interaction.update({ content: '', embeds: [embed], components });
      return true;
    }
  } catch (err) {
    await interaction.reply({ content: `Inventory action failed: ${err.message}`, ephemeral: true });
    return true;
  }

  return false;
}

export async function executeTcgTradeButton(interaction) {
  const [prefix, action, tradeId] = String(interaction.customId || '').split(':');
  if (prefix !== 'tcg_trade' || !tradeId) return false;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);

  try {
    const trade = getTradeWithExpiry(tradeId);
    if (!trade) {
      await interaction.reply({ content: 'Trade not found.', ephemeral });
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
        await interaction.reply({ content: 'Only the target user can reject this trade.', ephemeral });
        return true;
      }
      const rejected = rejectOffer(tradeId, interaction.user.id);
      await interaction.update({
        content: `Trade rejected.\n${summarizeTrade(rejected)}`,
        components: [],
      });
      return true;
    }
    await interaction.reply({ content: 'Unknown trade action.', ephemeral });
    return true;
  } catch (err) {
    await interaction.reply({ content: `Trade action failed: ${err.message}`, ephemeral });
    return true;
  }
}

export async function executeTcgPackButton(interaction) {
  const parts = String(interaction.customId || '').split(':');
  const [prefix, action, rawPage, rawView] = parts;
  if (prefix !== 'tcg_pack') return false;
  const page = Math.max(1, Number(rawPage || 1));
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);

  try {
    if (action === 'page') {
      const view = parts[2] === 'open' ? 'open' : 'claim';
      const direction = parts[3] === 'next' ? 'next' : 'prev';
      const currentIndex = Math.max(0, Number(parts[4] || 0));
      const nextPage = Math.max(1, currentIndex + 1 + (direction === 'next' ? 1 : -1));
      await interaction.deferUpdate();
      if (view === 'open') {
        await renderOpenQueue(interaction, { page: nextPage });
      } else {
        await renderClaimQueue(interaction, { page: nextPage });
      }
      return true;
    }
    if (action === 'view_claim') {
      await interaction.deferUpdate();
      await renderClaimQueue(interaction, { page });
      return true;
    }
    if (action === 'view_open') {
      await interaction.deferUpdate();
      await renderOpenQueue(interaction, { page });
      return true;
    }
    if (action === 'claim_top') {
      const top = listClaimablePacks(interaction.user.id, 1)[0];
      if (!top) {
        await interaction.reply({ content: 'No claimable packs right now.', ephemeral });
        return true;
      }
      claimPack(top.pack_id, interaction.user.id);
      await interaction.deferUpdate();
      await renderClaimQueue(interaction, { page });
      return true;
    }
    if (action === 'claim_cooldown') {
      try {
        claimCooldownPack(interaction.user.id);
      } catch (err) {
        await interaction.reply({ content: err.message === 'cooldown not ready' ? 'Cooldown pack is not ready yet.' : `Claim failed: ${err.message}`, ephemeral });
        return true;
      }
      await interaction.deferUpdate();
      await renderClaimQueue(interaction, { page });
      return true;
    }
    if (action === 'open_top') {
      const top = listUnopenedPacks(interaction.user.id, 1)[0];
      if (!top) {
        await interaction.reply({ content: 'No unopened packs right now.', ephemeral });
        return true;
      }
      await openClaimedPackById(interaction, top.pack_id);
      return true;
    }
    if (action === 'auto_claim_toggle') {
      const current = getTcgUserSettings(interaction.user.id);
      setAutoClaimEnabled(interaction.user.id, !current.auto_claim_enabled);
      await interaction.deferUpdate();
      if (rawView === 'open') {
        await renderOpenQueue(interaction, { page });
      } else {
        await renderClaimQueue(interaction, { page });
      }
      return true;
    }
    await interaction.reply({ content: 'Unknown pack action.', ephemeral });
    return true;
  } catch (err) {
    await interaction.reply({ content: `Pack action failed: ${err.message}`, ephemeral });
    return true;
  }
}

export async function executeTcgRevealButton(interaction) {
  const [prefix, action, sessionId] = String(interaction.customId || '').split(':');
  if (prefix !== 'tcg_reveal' || !sessionId) return false;
  const ephemeral = tcgEphemeral(VisibilityCategory.HIGH_NOISE);

  const session = getRevealSession(sessionId);
  if (!session) {
    await interaction.reply({ content: 'Reveal session not found or expired.', ephemeral });
    return true;
  }
  if (interaction.user.id !== session.user_id) {
    await interaction.reply({ content: 'Only the pack opener can control this reveal.', ephemeral });
    return true;
  }

  try {
    await interaction.deferUpdate();
    const dir = action === 'prev' ? -1 : 1;
    const nextSession = advanceRevealSession(sessionId, dir);
    const payload = await buildRevealPayload({
      session: nextSession,
      user: interaction.user,
      setCode: nextSession.cards[nextSession.current_index]?.set_code || 'set',
      rewards: null,
      includeValue: isVerboseTcgMode(),
      renderMedia: false,
    });
    await interaction.editReply(payload);
    return true;
  } catch (err) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `Reveal unavailable: ${err.message}`,
        embeds: [],
        components: [],
        files: [],
      });
    } else {
      await interaction.reply({ content: `Reveal unavailable: ${err.message}`, ephemeral });
    }
    return true;
  }
}
