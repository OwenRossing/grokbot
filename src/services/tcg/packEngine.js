import { getCardsBySet, getPackProfile, getTcgSetting } from './tcgStore.js';

const DEFAULT_SLOTS = [
  { tierMin: 1, tierMax: 1, count: 6 },
  { tierMin: 2, tierMax: 2, count: 3 },
  { tierMin: 3, tierMax: 6, count: 1 },
];

function randomItem(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function getSlots(productCode) {
  const profile = getPackProfile(productCode);
  if (!profile?.slots?.length) return DEFAULT_SLOTS;
  return profile.slots;
}

export function rollPack({ setCode, productCode }) {
  const cards = getCardsBySet(setCode);
  if (!cards.length) {
    throw new Error(`no cards cached for set ${setCode}`);
  }
  const slots = getSlots(productCode);
  const dropBoost = Number.parseFloat(getTcgSetting('drop_rate_event_multiplier', '1')) || 1;
  const pulls = [];
  for (const slot of slots) {
    const count = Math.max(1, Number(slot.count || 1));
    for (let i = 0; i < count; i += 1) {
      let tierMin = Number(slot.tierMin || 1);
      let tierMax = Number(slot.tierMax || 1);
      if (dropBoost > 1 && tierMin >= 3) {
        tierMax = Math.min(6, tierMax + 1);
      }
      const pool = cards.filter((card) => card.rarity_tier >= tierMin && card.rarity_tier <= tierMax);
      const picked = randomItem(pool.length ? pool : cards);
      if (picked) pulls.push(picked);
    }
  }
  return pulls;
}

