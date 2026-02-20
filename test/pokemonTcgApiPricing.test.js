import test from 'node:test';
import assert from 'node:assert/strict';

import { extractEstimatedFromCardPayload } from '../src/services/pricing/pokemonTcgApiPricing.js';

test('extracts tcgplayer holofoil market price when present', () => {
  const payload = {
    data: {
      id: 'sv1-1',
      tcgplayer: {
        updatedAt: '2026-01-05',
        prices: {
          holofoil: {
            market: 12.34,
            low: 10.0,
          },
        },
      },
    },
  };

  const result = extractEstimatedFromCardPayload(payload);
  assert.equal(result.dollars, 12.34);
  assert.equal(result.source, 'TCGplayer');
  assert.ok(Number.isFinite(result.updatedAt));
});

test('returns null estimate when tcgplayer prices are missing', () => {
  const payload = {
    data: {
      id: 'sv1-2',
      tcgplayer: {},
    },
  };

  const result = extractEstimatedFromCardPayload(payload);
  assert.equal(result.dollars, null);
  assert.equal(result.source, null);
  assert.equal(result.updatedAt, null);
});

