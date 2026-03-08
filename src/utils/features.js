function envFlag(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

export function isMarketsEnabled() {
  return envFlag('FEATURE_MARKETS_ENABLED', true);
}

export function isTcgLegacyEnabled() {
  return envFlag('FEATURE_TCG_LEGACY_ENABLED', false);
}

export const LEGACY_TCG_COMMAND_NAMES = [
  'claim-pack',
  'packs',
  'open-pack',
  'view-unopened-packs',
  'view-pack-completion',
  'auto-claim-pack',
  'inventory',
  'card-view',
  'collection-stats',
  'trade-offer',
  'trade-accept',
  'trade-reject',
  'trade-cancel',
  'trade-view',
  'market-value',
  'market-browse',
  'market-quote-buy',
  'market-buy',
  'market-quote-sell',
  'market-sell',
  'market-sell-duplicates',
  'admin-grant-pack',
  'admin-grant-credits',
  'admin-set-multiplier',
  'admin-trade-lock',
  'admin-event-create',
  'admin-event-list',
  'admin-event-enable',
  'admin-event-disable',
  'admin-event-delete',
  'admin-event-now',
  'admin-audit',
  'admin-rollback-trade',
];

export const TCG_LEGACY_DEPRECATION_MESSAGE =
  'TCG is archived right now. Use `/markets` for prediction markets (paper trading only).';
