import { searchBrave } from './brave.js';

export async function searchWeb({ query, limit = 5 }) {
  const provider = (process.env.WEB_SEARCH_PROVIDER || 'brave').toLowerCase();
  if (!query || !query.trim()) {
    return { ok: false, provider, error: 'empty query', results: [] };
  }

  if (provider === 'brave') {
    return searchBrave({ query: query.trim(), limit });
  }

  return {
    ok: false,
    provider,
    error: `unsupported provider: ${provider}`,
    results: [],
  };
}

export function shouldAutoWebSearch(prompt = '') {
  const value = String(prompt || '').toLowerCase();
  if (!value) return false;
  if (/(latest|today|current|news|search|look up|lookup|what happened|price|release date)/i.test(value)) {
    return true;
  }
  return false;
}
