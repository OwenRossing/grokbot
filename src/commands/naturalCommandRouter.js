import { parseNaturalCommandRequest, executeCommandRequestFromMessage } from './commandRuntime.js';
import { syncSetFromApi } from '../services/tcg/tcgApi.js';
import { rollPackDetailed } from '../services/tcg/packEngine.js';
import { runClaimAllAndOpenOne } from '../services/tcg/naturalMacros.js';
import {
  buildCompletionEmbedData,
  buildInventorySummaryText,
  buildPackOpenSummaryText,
} from '../services/tcg/tcgUx.js';
import {
  formatRarity,
  resolveSetName,
} from '../services/catalog/catalogResolver.js';
import {
  claimCooldownPack,
  claimPack,
  getUserRarestCard,
  getFreePackAvailability,
  getCardsBySet,
  getSetCompletionForUser,
  getInventoryPage,
  listClaimablePacks,
  listUnopenedPacks,
  openUnopenedPackWithMint,
  getTcgOverview,
} from '../services/tcg/tcgStore.js';

function normalizeSetCode(value) {
  return String(value || '').trim().toLowerCase();
}

const DEFAULT_TCG_SET_CODE = normalizeSetCode(process.env.TCG_DEFAULT_SET_CODE || 'sv1') || 'sv1';

function parseSetSyncError(err) {
  const text = String(err?.message || '');
  if (text.includes('set not found') || text.includes('pokemon api 404')) {
    return 'Unknown set code. Try `sv1` or omit set code for your default free pack.';
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

function parseSetCode(content) {
  const explicit = content.match(/\b(?:set|from)\s+([a-z0-9-]{2,12})\b/i);
  if (explicit?.[1]) return explicit[1].toLowerCase();
  const quick = content.match(/\b(sv\d{1,2}|swsh\d{1,2}|sm\d{1,2}|xy\d{1,2})\b/i);
  if (quick?.[1]) return quick[1].toLowerCase();
  return '';
}

function parsePage(content) {
  const pageMatch = content.match(/\bpage\s+(\d{1,3})\b/i);
  return pageMatch ? Math.max(1, Number(pageMatch[1])) : 1;
}

function parsePackId(content) {
  const packMatch = String(content || '').match(/\b(pack_[a-z0-9-]{8,})\b/i);
  return packMatch?.[1] || '';
}

function buildInfoEmbed(title, description, fields = []) {
  return {
    title,
    description,
    fields,
  };
}

function buildPackCooldownText(availability) {
  if (availability.available) return 'Your free pack is available now.';
  return `Your free pack is available <t:${Math.floor((availability.nextAt || Date.now()) / 1000)}:R>.`;
}

export function matchNaturalTcgCommand(content) {
  const text = String(content || '').toLowerCase();
  if (!text) return null;

  // Guard common non-TCG idioms that mention "pack/packing".
  if (/\bpack it up\b/.test(text) || /\bpacking (my|our|the) bags?\b/.test(text)) {
    return null;
  }

  const hasPackWord = /\b(pack|packs|booster|boosters)\b/.test(text);
  const hasTcgWord = /\b(tcg|pokemon|card|cards|inventory|collection|streak|credits)\b/.test(text);
  const hasMarketWord = /\b(market|buy|sell|duplicates?|list)\b/.test(text);
  const hasClaimWord = /\b(claim|grab|redeem|collect|get)\b/.test(text);
  const hasOpenWord = /\b(open|rip|reveal|unpack)\b/.test(text);
  const hasQueueWord = /\b(my|next|queue|queued|claimable|unopened|free|daily|cooldown)\b/.test(text);
  const hasCooldownQuestion = /\b(when|until|long|again|available|next|new)\b/.test(text);

  if (/\b(when|until|long)\b/.test(text) && /\bclaim\b/.test(text) && /\bagain\b/.test(text) && !hasOpenWord) {
    return { action: 'pack_cooldown_status' };
  }

  if (hasPackWord && hasCooldownQuestion && /\b(claim|free|cooldown|next|again|available|get|new)\b/.test(text) && !hasOpenWord) {
    return { action: 'pack_cooldown_status' };
  }

  if (hasPackWord && hasClaimWord && hasOpenWord) {
    return { action: 'claim_all_and_open_one' };
  }

  if (/\b(claim all my packs|claim my packs|claim packs)\b/.test(text)) {
    return { action: 'claim_all_packs' };
  }

  if (/\b(open a pack|open next pack|open one)\b/.test(text)) {
    return { action: 'open_next_pack' };
  }

  if (/\b(view my rarest card|show my rarest card|my best card|most valuable card|rarest card)\b/.test(text)) {
    return { action: 'view_rarest_card' };
  }

  if ((/\bhow\b.*\bmarket\b/.test(text) || /\bhow do i\b.*\b(buy|list|sell)\b.*\bcard\b/.test(text))) {
    return { action: 'market_help' };
  }

  if (/\b(sell my duplicates|sell duplicates|sell dupes|sell duplicates on the market)\b/.test(text)) {
    return { action: 'sell_duplicates_intent' };
  }

  if (/\b(sell|trade)\b.*\bduplicates?\b.*\bmarket\b/.test(text) || /\bcan you sell my duplicates on the market\b/.test(text)) {
    return { action: 'sell_duplicates_intent' };
  }

  if (/\bhow do packs work\b/.test(text) || /\bwhat commands do i use for cards\b/.test(text)) {
    return { action: 'tcg_help' };
  }

  if ((/\b(card|cards)\b/.test(text) && /\b(view|show|see)\b/.test(text)) || /\bshow me .* card\b/.test(text)) {
    return { action: 'card_view' };
  }

  if (!hasTcgWord && !hasMarketWord && !(hasPackWord && hasQueueWord) && !(hasPackWord && hasCooldownQuestion)) return null;

  if (/\b(inventory|cards)\b/.test(text) && /\b(show|view|check|list|my)\b/.test(text)) {
    return {
      action: 'inventory',
      page: parsePage(text),
    };
  }

  if (/\b(stats|collection|overview|credits|streak)\b/.test(text)) {
    return {
      action: 'collection_stats',
    };
  }

  if ((/\b(completion|complete|missing)\b/.test(text) && /\b(pack|set|collection|cards?)\b/.test(text)) ||
    /\bpack completion\b/.test(text)) {
    return {
      action: 'pack_completion',
      setCode: normalizeSetCode(parseSetCode(text) || DEFAULT_TCG_SET_CODE),
    };
  }

  if (/\b(show|view|list|check|see|what)\b/.test(text) && /\b(claimable|to claim)\b/.test(text) && hasPackWord) {
    return { action: 'view_claimable_packs' };
  }

  if (/\b(show|view|list|check|see|what)\b/.test(text) && /\b(unopened|ready|to open|openable)\b/.test(text) && hasPackWord) {
    return { action: 'view_unopened_packs' };
  }

  if (hasClaimWord && hasPackWord && (hasTcgWord || hasQueueWord)) {
    return {
      action: 'claim_pack',
      packId: parsePackId(text),
      setCode: normalizeSetCode(parseSetCode(text)),
    };
  }

  if (hasOpenWord && hasPackWord && (hasTcgWord || hasQueueWord)) {
    return {
      action: 'open_pack',
      packId: parsePackId(text),
      allowClaimFallback: /\b(free|daily|cooldown)\b/.test(text),
    };
  }

  return null;
}

async function tryHandleNaturalMemoryStatus({ message, content }) {
  const parsed = parseNaturalCommandRequest(content || message.content || '', {
    actorId: message.author.id,
  });
  if (!parsed) return false;

  await executeCommandRequestFromMessage({
    message,
    request: parsed.request,
    dryRun: parsed.dryRun,
    superAdminId: process.env.SUPER_ADMIN_USER_ID,
  });

  return true;
}

async function tryHandleNaturalTcg({ message, content }) {
  const parsed = matchNaturalTcgCommand(content || message.content || '');
  if (!parsed) return false;

  try {
    const claimAllAvailablePacks = (userId, setCode = DEFAULT_TCG_SET_CODE) => {
      let claimedCount = 0;
      while (true) {
        const top = listClaimablePacks(userId, 1)[0];
        if (!top) break;
        claimPack(top.pack_id, userId);
        claimedCount += 1;
      }
      const availability = getFreePackAvailability(userId);
      if (availability.available) {
        try {
          claimCooldownPack(userId, setCode);
          claimedCount += 1;
        } catch {
          // Best-effort cooldown claim.
        }
      }
      const unopenedAfter = listUnopenedPacks(userId, 100).length;
      return { claimedCount, unopenedAfter };
    };

    const openNextPack = async ({ userId, guildId, messageId, allowClaimFallback = false, packId = '' }) => {
      let selectedPack = null;
      if (packId) {
        selectedPack = listUnopenedPacks(userId, 100).find((pack) => pack.pack_id === packId) || null;
        if (!selectedPack) return { ok: false, reason: 'missing_pack' };
      } else {
        selectedPack = listUnopenedPacks(userId, 1)[0] || null;
      }

      if (!selectedPack && allowClaimFallback) {
        try {
          selectedPack = claimCooldownPack(userId, DEFAULT_TCG_SET_CODE);
        } catch (err) {
          if (err?.message !== 'cooldown not ready') throw err;
        }
      }

      if (!selectedPack) {
        const claimableCount = listClaimablePacks(userId, 100).length;
        if (claimableCount > 0) return { ok: false, reason: 'need_claim_first', claimableCount };
        return { ok: false, reason: 'no_unopened', availability: getFreePackAvailability(userId) };
      }

      try {
        await syncSetFromApi(selectedPack.set_code);
      } catch (err) {
        const setErr = parseSetSyncError(err);
        if (isTransientSetSyncError(err) && getCardsBySet(selectedPack.set_code).length > 0) {
          console.warn(`Using cached set data for ${selectedPack.set_code} due to API outage:`, err.message);
        } else if (setErr) {
          return { ok: false, reason: 'set_error', message: setErr };
        } else {
          throw err;
        }
      }

      const productCode = selectedPack.product_code || `${selectedPack.set_code}-default`;
      const drop = rollPackDetailed({
        userId,
        setCode: selectedPack.set_code,
        productCode,
      });
      const created = openUnopenedPackWithMint({
        idempotencyKey: `msg:${messageId}`,
        userId,
        guildId,
        packId: selectedPack.pack_id,
        pulls: drop.pulls,
        profileVersion: drop.profileVersion,
        dropAudit: drop.audit,
        pityTriggered: drop.pityTriggered,
      });
      const remainingUnopened = listUnopenedPacks(userId, 100).length;
      return { ok: true, selectedPack, created, remainingUnopened };
    };

    if (parsed.action === 'pack_cooldown_status') {
      const availability = getFreePackAvailability(message.author.id);
      await message.reply({
        embeds: [buildInfoEmbed('Pack Cooldown', buildPackCooldownText(availability))],
      });
      return true;
    }

    if (parsed.action === 'claim_all_packs') {
      const claimed = claimAllAvailablePacks(message.author.id, DEFAULT_TCG_SET_CODE);
      await message.reply({
        embeds: [buildInfoEmbed(
          'Pack Claim Summary',
          `Claimed: **${claimed.claimedCount}**\nUnopened queue: **${claimed.unopenedAfter}**`
        )],
      });
      return true;
    }

    if (parsed.action === 'open_next_pack') {
      await message.channel.sendTyping();
      const opened = await openNextPack({
        userId: message.author.id,
        guildId: message.guildId,
        messageId: message.id,
        allowClaimFallback: true,
      });
      if (!opened.ok) {
        if (opened.reason === 'need_claim_first') {
          await message.reply({
            embeds: [buildInfoEmbed('Open Pack', `You have ${opened.claimableCount} claimable pack(s). Claim first, then open.`)],
          });
          return true;
        }
        if (opened.reason === 'set_error') {
          await message.reply({ embeds: [buildInfoEmbed('Open Pack', opened.message)] });
          return true;
        }
        await message.reply({
          embeds: [buildInfoEmbed('Open Pack', `No unopened packs right now. ${buildPackCooldownText(opened.availability)}`)],
        });
        return true;
      }
      const rewards = opened.created.result.rewards;
      await message.reply({
        embeds: [buildInfoEmbed(
          'Pack Opened',
          buildPackOpenSummaryText({
            openerLabel: String(message.author),
            setCode: opened.selectedPack.set_code,
            mintedCards: opened.created.result.minted,
            rewards,
            remainingUnopened: opened.remainingUnopened,
          })
        )],
      });
      return true;
    }

    if (parsed.action === 'claim_all_and_open_one') {
      await message.channel.sendTyping();
      const macro = await runClaimAllAndOpenOne({
        claimAllFn: async () => claimAllAvailablePacks(message.author.id, DEFAULT_TCG_SET_CODE),
        openNextFn: async () => openNextPack({
          userId: message.author.id,
          guildId: message.guildId,
          messageId: message.id,
          allowClaimFallback: false,
        }),
      });
      const embeds = [
        buildInfoEmbed(
          'Claim + Open',
          `Claimed: **${macro.claim.claimedCount}**\nUnopened queue: **${macro.claim.unopenedAfter}**`
        ),
      ];
      if (macro.open?.ok) {
        const rewards = macro.open.created.result.rewards;
        embeds.push(buildInfoEmbed(
          'Pack Opened',
          buildPackOpenSummaryText({
            openerLabel: String(message.author),
            setCode: macro.open.selectedPack.set_code,
            mintedCards: macro.open.created.result.minted,
            rewards,
            remainingUnopened: macro.open.remainingUnopened,
          })
        ));
      } else if (macro.open?.reason === 'set_error') {
        embeds.push(buildInfoEmbed('Open Pack', macro.open.message));
      } else if (macro.claim.unopenedAfter <= 0) {
        embeds.push(buildInfoEmbed('Open Pack', 'No unopened packs available to open.'));
      }
      await message.reply({ embeds });
      return true;
    }

    if (parsed.action === 'view_rarest_card') {
      const card = getUserRarestCard(message.author.id);
      if (!card) {
        await message.reply({
          embeds: [buildInfoEmbed('Rarest Card', 'You do not have any cards yet. Open a pack first.')],
        });
        return true;
      }
      const embed = {
        title: card.name || 'Rarest Card',
        description:
          `Set ${resolveSetName(card.set_code)} • ${formatRarity(card.rarity)}\n` +
          `Rarity Tier: ${card.rarity_tier || 1}`,
        fields: [
          { name: 'Estimated', value: Number.isFinite(Number(card.market_price_usd)) ? `$${Number(card.market_price_usd).toFixed(2)}` : '—', inline: true },
        ],
      };
      if (card.image_large || card.image_small) {
        embed.image = { url: card.image_large || card.image_small };
      }
      await message.reply({ embeds: [embed] });
      return true;
    }

    if (parsed.action === 'tcg_help') {
      await message.reply({
        embeds: [buildInfoEmbed(
          'TCG Help',
          'Use these commands to manage packs and cards.',
          [
            { name: 'Packs', value: '`/packs`, `/claim-pack`, `/open-pack`', inline: false },
            { name: 'Collection', value: '`/inventory`, `/card-view`, `/view-pack-completion`', inline: false },
            { name: 'Market', value: '`/market-browse`, `/market-buy`, `/market-sell`', inline: false },
          ]
        )],
      });
      return true;
    }

    if (parsed.action === 'market_help') {
      await message.reply({
        embeds: [buildInfoEmbed(
          'How Market Works',
          'Use slash commands for market actions.',
          [
            { name: 'Browse', value: '`/market-browse`', inline: false },
            { name: 'List/Sell', value: '`/market-sell` or `/market-sell-duplicates`', inline: false },
            { name: 'Buy', value: '`/market-buy`', inline: false },
          ]
        )],
      });
      return true;
    }

    if (parsed.action === 'sell_duplicates_intent') {
      await message.reply({
        embeds: [buildInfoEmbed(
          'Duplicates',
          'Selling duplicates automatically is not supported in natural chat. Use `/packs` -> `Trade In`.'
        )],
      });
      return true;
    }

    if (parsed.action === 'card_view') {
      await message.reply({
        embeds: [buildInfoEmbed(
          'Card View',
          'Use `/card-view` and start typing the card name.'
        )],
      });
      return true;
    }

    if (parsed.action === 'claim_pack') {
      let claimed = null;
      if (parsed.packId) {
        claimed = claimPack(parsed.packId, message.author.id);
      } else {
        const top = listClaimablePacks(message.author.id, 1)[0];
        if (top) {
          claimed = claimPack(top.pack_id, message.author.id);
        } else {
          try {
            claimed = claimCooldownPack(message.author.id, parsed.setCode || DEFAULT_TCG_SET_CODE);
          } catch (err) {
            if (err?.message === 'cooldown not ready') {
              const availability = getFreePackAvailability(message.author.id);
              await message.reply({
                content:
                  `No claimable packs right now. Your free pack is available ` +
                  `<t:${Math.floor((availability.nextAt || Date.now()) / 1000)}:R>.`,
              });
              return true;
            }
            throw err;
          }
        }
      }

      const unopenedCount = listUnopenedPacks(message.author.id, 100).length;
      await message.reply({
        content:
          `${message.author} claimed a **${resolveSetName(claimed.set_code)}** pack. ` +
          `You now have ${unopenedCount} unopened pack${unopenedCount === 1 ? '' : 's'}. ` +
          `Say "open my pack" to open it.`,
      });
      return true;
    }

    if (parsed.action === 'open_pack') {
      await message.channel.sendTyping();
      let selectedPack = null;

      if (parsed.packId) {
        selectedPack = listUnopenedPacks(message.author.id, 100).find((pack) => pack.pack_id === parsed.packId) || null;
        if (!selectedPack) {
          await message.reply({ content: 'That pack is not in your unopened queue.' });
          return true;
        }
      } else {
        selectedPack = listUnopenedPacks(message.author.id, 1)[0] || null;
      }

      if (!selectedPack && parsed.allowClaimFallback) {
        try {
          selectedPack = claimCooldownPack(message.author.id, DEFAULT_TCG_SET_CODE);
        } catch (err) {
          if (err?.message !== 'cooldown not ready') throw err;
        }
      }

      if (!selectedPack) {
        const claimableCount = listClaimablePacks(message.author.id, 100).length;
        if (claimableCount > 0) {
          await message.reply({
            content: `You have ${claimableCount} claimable pack${claimableCount === 1 ? '' : 's'}. Say "claim my packs" first.`,
          });
          return true;
        }
        const availability = getFreePackAvailability(message.author.id);
        await message.reply({
          content:
            `No unopened packs right now. Your free pack is available ` +
            `${availability.available ? 'now' : `<t:${Math.floor((availability.nextAt || Date.now()) / 1000)}:R>`}.`,
        });
        return true;
      }

      try {
        await syncSetFromApi(selectedPack.set_code);
      } catch (err) {
        const setErr = parseSetSyncError(err);
        if (isTransientSetSyncError(err) && getCardsBySet(selectedPack.set_code).length > 0) {
          console.warn(`Using cached set data for ${selectedPack.set_code} due to API outage:`, err.message);
        } else if (setErr) {
          await message.reply({ content: setErr });
          return true;
        } else {
          throw err;
        }
      }

      const productCode = selectedPack.product_code || `${selectedPack.set_code}-default`;
      const drop = rollPackDetailed({
        userId: message.author.id,
        setCode: selectedPack.set_code,
        productCode,
      });

      const created = openUnopenedPackWithMint({
        idempotencyKey: `msg:${message.id}`,
        userId: message.author.id,
        guildId: message.guildId,
        packId: selectedPack.pack_id,
        pulls: drop.pulls,
        profileVersion: drop.profileVersion,
        dropAudit: drop.audit,
        pityTriggered: drop.pityTriggered,
      });

      const rewards = created.result.rewards;
      const remainingUnopened = listUnopenedPacks(message.author.id, 100).length;
      await message.reply({
        content: buildPackOpenSummaryText({
          openerLabel: String(message.author),
          setCode: selectedPack.set_code,
          mintedCards: created.result.minted,
          rewards,
          remainingUnopened,
        }),
      });
      return true;
    }

    if (parsed.action === 'view_claimable_packs') {
      const rows = listClaimablePacks(message.author.id, 10);
      const availability = getFreePackAvailability(message.author.id);
      const lines = rows.map((row, idx) =>
        `${idx + 1}. ${String(row.set_code || '').toUpperCase()} • ${row.grant_source || 'claimable'}`
      );
      await message.reply({
        content:
          `Claimable packs: ${rows.length}\n` +
          `${lines.join('\n') || 'None'}\n` +
          `Free pack cooldown: ${availability.available ? 'ready now' : `<t:${Math.floor((availability.nextAt || Date.now()) / 1000)}:R>`}`,
      });
      return true;
    }

    if (parsed.action === 'view_unopened_packs') {
      const rows = listUnopenedPacks(message.author.id, 10);
      const lines = rows.map((row, idx) =>
        `${idx + 1}. ${String(row.set_code || '').toUpperCase()} • ${row.grant_source || 'unopened'}`
      );
      await message.reply({
        content:
          `Unopened packs: ${rows.length}\n` +
          `${lines.join('\n') || 'None'}\n` +
          `Say "open my pack" to open the next one.`,
      });
      return true;
    }

    if (parsed.action === 'inventory') {
      const inv = getInventoryPage({
        userId: message.author.id,
        page: parsed.page || 1,
        pageSize: 10,
        setCode: '',
        nameLike: '',
      });
      await message.reply({
        content: buildInventorySummaryText({
          ownerLabel: 'Your',
          page: inv.page,
          totalPages: inv.totalPages,
          total: inv.total,
          rows: inv.rows,
          includeRef: false,
        }),
      });
      return true;
    }

    if (parsed.action === 'pack_completion') {
      const requestedSetCode = normalizeSetCode(parsed.setCode || DEFAULT_TCG_SET_CODE);
      try {
        await syncSetFromApi(requestedSetCode);
      } catch (err) {
        const setErr = parseSetSyncError(err);
        if (isTransientSetSyncError(err) && getCardsBySet(requestedSetCode).length > 0) {
          console.warn(`Using cached set data for ${requestedSetCode} due to API outage:`, err.message);
        } else if (setErr) {
          await message.reply({ content: setErr });
          return true;
        } else {
          throw err;
        }
      }
      const completion = getSetCompletionForUser(message.author.id, requestedSetCode);
      if (!completion.total) {
        await message.reply({
          content: `No cards cached for set \`${requestedSetCode}\` yet. Try opening/claiming from that set first.`,
        });
        return true;
      }
      const ui = buildCompletionEmbedData(completion);
      const embed = {
        title: ui.title,
        description: ui.description,
        fields: ui.fields,
      };
      if (ui.featuredImageUrl) embed.image = { url: ui.featuredImageUrl };
      await message.reply({ embeds: [embed] });
      return true;
    }

    if (parsed.action === 'collection_stats') {
      const overview = getTcgOverview(message.author.id);
      await message.reply({
        content:
          `Cards: ${overview.inventoryCount}\n` +
          `Credits: ${overview.wallet.credits}\n` +
          `Opened packs: ${overview.wallet.opened_count}\n` +
          `Streak: ${overview.wallet.streak_days}\n` +
          `Free pack: ${overview.cooldown.available ? 'ready' : `<t:${Math.floor(overview.cooldown.nextAt / 1000)}:R>`}`,
      });
      return true;
    }
  } catch (err) {
    console.error('Natural TCG command error:', {
      userId: message.author?.id,
      guildId: message.guildId,
      content: String(content || message.content || '').slice(0, 160),
      error: err?.message || String(err),
    });
    await message.reply({ content: `TCG command failed: ${err.message}` });
    return true;
  }

  return false;
}

export async function tryHandleNaturalCommand({ message, content }) {
  const handledMemory = await tryHandleNaturalMemoryStatus({ message, content });
  if (handledMemory) return true;
  return tryHandleNaturalTcg({ message, content });
}
