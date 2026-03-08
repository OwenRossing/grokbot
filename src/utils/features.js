function envFlag(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

export function isMarketsEnabled() {
  return envFlag('FEATURE_MARKETS_ENABLED', true);
}
