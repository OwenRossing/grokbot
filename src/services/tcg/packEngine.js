import {
  getEffectiveEventEffects,
  getActivePackProfileVersion,
  getCardsBySet,
  getPackProfile,
  getPityState,
  getTcgSetting,
} from './tcgStore.js';

const DEFAULT_SLOTS = [
  { tierMin: 1, tierMax: 1, count: 6 },
  { tierMin: 2, tierMax: 2, count: 3 },
  { tierMin: 3, tierMax: 6, count: 1 },
];

function randomItem(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function validatePackProfile(profile, cards = []) {
  const slots = Array.isArray(profile?.slots) ? profile.slots : [];
  if (!slots.length) {
    return { ok: false, reason: 'missing slots' };
  }
  for (const slot of slots) {
    const tierMin = toInt(slot?.tierMin, 1);
    const tierMax = toInt(slot?.tierMax, 1);
    const count = toInt(slot?.count, 1);
    if (tierMin < 1 || tierMax > 6 || tierMin > tierMax) {
      return { ok: false, reason: `invalid tier range (${tierMin}-${tierMax})` };
    }
    if (count < 1 || count > 20) {
      return { ok: false, reason: `invalid slot count (${count})` };
    }
    const poolSize = cards.filter((card) => {
      const tier = Number(card?.rarity_tier || 0);
      return tier >= tierMin && tier <= tierMax;
    }).length;
    if (poolSize === 0) {
      return { ok: false, reason: `empty slot pool for tier range ${tierMin}-${tierMax}` };
    }
  }
  return { ok: true, reason: '' };
}

function getSlots(productCode) {
  const profile = getPackProfile(productCode);
  if (!profile?.slots?.length) return DEFAULT_SLOTS;
  return profile.slots;
}

function buildSlotPool(cards, tierMin, tierMax) {
  return cards.filter((card) => {
    const tier = Number(card?.rarity_tier || 0);
    return tier >= tierMin && tier <= tierMax;
  });
}

function enforceGuaranteeMinTier(pulls, cards, minTier) {
  if (!minTier || minTier <= 1) return { pulls, guaranteeApplied: false };
  const hasMinTier = pulls.some((card) => Number(card?.rarity_tier || 0) >= minTier);
  if (hasMinTier) return { pulls, guaranteeApplied: false };
  const candidates = cards.filter((card) => Number(card?.rarity_tier || 0) >= minTier);
  const replacement = randomItem(candidates);
  if (!replacement || pulls.length === 0) return { pulls, guaranteeApplied: false };
  const copy = [...pulls];
  copy[copy.length - 1] = replacement;
  return { pulls: copy, guaranteeApplied: true };
}

function applyPityIfNeeded({ pulls, cards, userId, productCode, pityKey }) {
  const pityEnabled = getTcgSetting('pity_enabled', '1') === '1';
  if (!pityEnabled) return { pulls, pityTriggered: false, pityBefore: null };

  const threshold = Math.max(1, toInt(getTcgSetting('pity_threshold_tier5', '30'), 30));
  const pity = getPityState(userId, productCode, pityKey);
  const currentCount = Number(pity?.open_count_since_hit || 0);
  const needsPity = currentCount + 1 >= threshold;
  if (!needsPity) return { pulls, pityTriggered: false, pityBefore: pity };

  const pityPool = cards.filter((card) => Number(card?.rarity_tier || 0) >= 5);
  const pityCard = randomItem(pityPool);
  if (!pityCard || pulls.length === 0) return { pulls, pityTriggered: false, pityBefore: pity };
  const copy = [...pulls];
  copy[copy.length - 1] = pityCard;
  return { pulls: copy, pityTriggered: true, pityBefore: pity };
}

export function rollPackDetailed({ userId, setCode, productCode }) {
  const cards = getCardsBySet(setCode);
  if (!cards.length) {
    throw new Error(`no cards cached for set ${setCode}`);
  }

  const slots = getSlots(productCode);
  const profileVersionRow = getActivePackProfileVersion(productCode);
  const profile = profileVersionRow?.profile?.slots?.length
    ? profileVersionRow.profile
    : { slots };
  const profileValidation = validatePackProfile(profile, cards);
  if (!profileValidation.ok) {
    throw new Error(`pack profile invalid: ${profileValidation.reason}`);
  }

  const settingsDropBoost = Number.parseFloat(getTcgSetting('drop_rate_event_multiplier', '1')) || 1;
  const eventEffects = getEffectiveEventEffects({ setCode });
  const dropBoost = Math.max(1, settingsDropBoost * Number(eventEffects.dropBoostMultiplier || 1));
  const pulls = [];
  const slotAudit = [];
  for (const slot of profile.slots) {
    const count = Math.max(1, toInt(slot?.count, 1));
    const baseTierMin = toInt(slot?.tierMin, 1);
    let tierMax = toInt(slot?.tierMax, 1);
    if (dropBoost > 1 && baseTierMin >= 3) {
      tierMax = Math.min(6, tierMax + 1);
    }
    for (let i = 0; i < count; i += 1) {
      const pool = buildSlotPool(cards, baseTierMin, tierMax);
      const picked = randomItem(pool.length ? pool : cards);
      if (picked) pulls.push(picked);
      slotAudit.push({
        tierMin: baseTierMin,
        tierMax,
        poolSize: pool.length,
        pickedCardId: picked?.card_id || '',
        pickedTier: Number(picked?.rarity_tier || 0),
      });
    }
  }

  const guaranteeMinTier = Math.max(1, toInt(getTcgSetting('guarantee_min_tier', '3'), 3));
  const guaranteed = enforceGuaranteeMinTier(pulls, cards, guaranteeMinTier);
  const pityResult = applyPityIfNeeded({
    pulls: guaranteed.pulls,
    cards,
    userId,
    productCode,
    pityKey: 'tier5_plus',
  });

  return {
    pulls: pityResult.pulls,
    profileVersion: profileVersionRow ? `${profileVersionRow.product_code}:${profileVersionRow.version}` : `${productCode}:legacy`,
    pityTriggered: pityResult.pityTriggered,
    audit: {
      productCode,
      setCode,
      profileValid: true,
      profileReason: profileValidation.reason || 'ok',
      guaranteeMinTier,
      guaranteeApplied: guaranteed.guaranteeApplied,
      pityThreshold: Math.max(1, toInt(getTcgSetting('pity_threshold_tier5', '30'), 30)),
      pityBefore: pityResult.pityBefore || null,
      slotAudit,
    },
  };
}

export function rollPack({ setCode, productCode }) {
  const result = rollPackDetailed({
    userId: '',
    setCode,
    productCode,
  });
  return result.pulls;
}
