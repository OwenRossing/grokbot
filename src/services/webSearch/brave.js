export async function searchBrave({ query, limit = 5 }) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return { ok: false, provider: 'brave', error: 'BRAVE_SEARCH_API_KEY missing', results: [] };
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 10)));

  const start = Date.now();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      provider: 'brave',
      error: `Brave API ${res.status}: ${body.slice(0, 200)}`,
      results: [],
      latencyMs: Date.now() - start,
    };
  }

  const data = await res.json();
  const results = (data?.web?.results || []).slice(0, limit).map((item) => ({
    title: item?.title || 'Untitled',
    url: item?.url || '',
    snippet: item?.description || '',
    source: 'brave',
  })).filter((r) => r.url);

  return {
    ok: true,
    provider: 'brave',
    results,
    latencyMs: Date.now() - start,
  };
}
