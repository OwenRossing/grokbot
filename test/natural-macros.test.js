import test from 'node:test';
import assert from 'node:assert/strict';

import { runClaimAllAndOpenOne, shouldOpenAfterClaim } from '../src/services/tcg/naturalMacros.js';

test('shouldOpenAfterClaim only opens when unopened packs exist', () => {
  assert.equal(shouldOpenAfterClaim({ unopenedAfter: 0 }), false);
  assert.equal(shouldOpenAfterClaim({ unopenedAfter: 1 }), true);
});

test('runClaimAllAndOpenOne runs open step only when queue has packs', async () => {
  const calls = [];
  const result = await runClaimAllAndOpenOne({
    claimAllFn: async () => {
      calls.push('claim');
      return { claimedCount: 2, unopenedAfter: 1 };
    },
    openNextFn: async () => {
      calls.push('open');
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['claim', 'open']);
  assert.equal(result.open.ok, true);
});

test('runClaimAllAndOpenOne skips open step when queue empty', async () => {
  const calls = [];
  const result = await runClaimAllAndOpenOne({
    claimAllFn: async () => {
      calls.push('claim');
      return { claimedCount: 0, unopenedAfter: 0 };
    },
    openNextFn: async () => {
      calls.push('open');
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['claim']);
  assert.equal(result.open, null);
});

