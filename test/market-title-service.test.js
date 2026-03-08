import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachDisplayTitle,
  buildRuleBasedDisplayTitle,
  getDisplayTitle,
  shouldRefreshDisplayTitle,
} from '../src/services/markets/marketTitleService.js';

const ORIGINAL_ENV = {
  MARKETS_TITLE_AI_ENABLED: process.env.MARKETS_TITLE_AI_ENABLED,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS,
};

function restoreEnv() {
  for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

test('rules normalizer cleans noisy title formats', () => {
  const result = buildRuleBasedDisplayTitle({
    ticker: 'KXHIGH-2026',
    title: 'EVENT: US PRES 2028 - WILL GOP WIN?? | YES_PRICE',
    category: 'politics',
  });
  assert.ok(result.displayTitle.length > 0);
  assert.ok(!result.displayTitle.includes('|'));
  assert.ok(!result.displayTitle.includes('_'));
  assert.equal(result.titleSource, 'rules');
  assert.ok(result.qualityScore >= 0 && result.qualityScore <= 1);
});

test('attachDisplayTitle prefers cached display fields', () => {
  const output = attachDisplayTitle({
    title: 'RAW TITLE',
    display_title: 'Readable Title',
    display_subtitle: 'Readable subtitle',
    title_source: 'ollama',
  });
  assert.equal(output.displayTitle, 'Readable Title');
  assert.equal(output.displaySubtitle, 'Readable subtitle');
  assert.equal(output.titleSource, 'ollama');
});

test('getDisplayTitle falls back to rules when ollama fails', async () => {
  process.env.MARKETS_TITLE_AI_ENABLED = '1';
  process.env.OLLAMA_MODEL = 'qwen2.5:0.5b-instruct';
  process.env.OLLAMA_TIMEOUT_MS = '100';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('offline');
  };

  let result;
  try {
    result = await getDisplayTitle({
      ticker: 'GDP-2026',
      title: 'GDP__Q1___US',
      category: 'economy',
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }

  assert.equal(result.titleSource, 'rules');
  assert.ok(result.displayTitle.length > 0);
});

test('title refresh check respects ttl and missing display fields', () => {
  const ts = Date.now();
  assert.equal(shouldRefreshDisplayTitle({}), true);
  assert.equal(shouldRefreshDisplayTitle({ display_title: 'Readable', title_updated_at: ts }), false);
  assert.equal(shouldRefreshDisplayTitle({ display_title: 'Readable', title_updated_at: ts - (8 * 60 * 60 * 1000) }, ts), true);
});
