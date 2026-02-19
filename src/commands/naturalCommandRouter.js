import { parseNaturalCommandRequest, executeCommandRequestFromMessage } from './commandRuntime.js';
import { syncSetFromApi } from '../services/tcg/tcgApi.js';
import { rollPackDetailed } from '../services/tcg/packEngine.js';
import {
  claimCooldownPack,
  claimPack,
  getFreePackAvailability,
  getCardsBySet,
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

function matchNaturalTcgCommand(content) {
  const text = String(content || '').toLowerCase();
  if (!text) return null;
  const hasPackWord = /\b(pack|packs|booster|boosters)\b/.test(text);
  const hasTcgWord = /\b(tcg|pokemon|card|cards|inventory|collection|streak|credits)\b/.test(text);
  const hasQueueWord = /\b(my|next|queue|queued|claimable|unopened|free|daily|cooldown)\b/.test(text);

  if (!hasTcgWord && !(hasPackWord && hasQueueWord)) return null;

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

  if (/\b(show|view|list|check|see|what)\b/.test(text) && /\b(claimable|to claim)\b/.test(text) && hasPackWord) {
    return { action: 'view_claimable_packs' };
  }

  if (/\b(show|view|list|check|see|what)\b/.test(text) && /\b(unopened|ready|to open|openable)\b/.test(text) && hasPackWord) {
    return { action: 'view_unopened_packs' };
  }

  if (/\b(claim|grab|redeem|collect|get)\b/.test(text) && hasPackWord && (hasTcgWord || hasQueueWord)) {
    return {
      action: 'claim_pack',
      packId: parsePackId(text),
      setCode: normalizeSetCode(parseSetCode(text)),
    };
  }

  if (/\b(open|rip|reveal|unpack)\b/.test(text) && hasPackWord && (hasTcgWord || hasQueueWord)) {
    return {
      action: 'open_pack',
      packId: parsePackId(text),
      allowClaimFallback: /\b(free|daily|cooldown)\b/.test(text),
    };
  }

  return null;
}

function formatPackLines(cards) {
  return cards.map((card, idx) => {
    const stars = '★'.repeat(Math.max(1, Math.min(6, Number(card.rarity_tier || 1))));
    return `${idx + 1}. ${card.name} [${card.rarity || 'Unknown'}] ${stars}`;
  });
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
          `${message.author} claimed a **${String(claimed.set_code || '').toUpperCase()}** pack. ` +
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
        content:
          `${message.author} opened a **${String(selectedPack.set_code || '').toUpperCase()}** booster.\n` +
          `${formatPackLines(created.result.minted).join('\n')}\n\n` +
          `Credits earned: ${rewards.earned} (base ${rewards.base} + streak ${rewards.streakBonus})\n` +
          `Unopened packs left: ${remainingUnopened}`,
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
      const lines = inv.rows.map((row, idx) =>
        `${idx + 1}. ${row.name} [${row.rarity || 'Unknown'}] (${row.set_code})`
      );
      await message.reply({
        content:
          `Your inventory page ${inv.page}/${inv.totalPages} (${inv.total} cards)\n` +
          `${lines.join('\n') || 'No cards.'}`,
      });
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
