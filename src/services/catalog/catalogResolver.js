import { getSet } from '../tcg/tcgStore.js';

const FALLBACK_SET_NAMES = {
  sv1: 'Scarlet & Violet',
};

const RARITY_ALIASES = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  'rare holo': 'Rare Holo',
  'rare holo ex': 'Rare Holo EX',
  'double rare': 'Double Rare',
  'illustration rare': 'Illustration Rare',
  'special illustration rare': 'Special Illustration Rare',
  'hyper rare': 'Hyper Rare',
  promo: 'Promo',
};

function titleCase(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : '')
    .join(' ');
}

function formatGrantSource(source = '') {
  const safe = String(source || '').trim().toLowerCase();
  if (!safe) return '';
  if (safe === 'auto_claim_sweep') return 'Auto-claimed';
  if (safe === 'admin_grant') return 'Admin grant';
  if (safe === 'daily_free' || safe === 'free_cooldown') return 'Free pack';
  return titleCase(safe.replace(/_/g, ' '));
}

export function resolveSetName(setCode = '') {
  const safeCode = String(setCode || '').trim().toLowerCase();
  if (!safeCode) return 'Unknown Set';
  const cached = getSet(safeCode);
  if (cached?.name) return cached.name;
  return FALLBACK_SET_NAMES[safeCode] || safeCode.toUpperCase();
}

export function formatRarity(rarity = '') {
  const safe = String(rarity || '').trim().toLowerCase();
  if (!safe) return 'Unknown';
  return RARITY_ALIASES[safe] || titleCase(safe.replace(/_/g, ' '));
}

export function formatPackDisplayName(pack = {}) {
  const setName = resolveSetName(pack?.set_code || '');
  const source = formatGrantSource(pack?.grant_source || '');
  return source ? `${setName} • ${source}` : setName;
}
