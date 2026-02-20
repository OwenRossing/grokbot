import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeUserTextForLlm } from '../src/utils/sanitizeForLlm.js';

test('removes repeated spam token like pizza', () => {
  const input = 'PIZZA PIZZA PIZZA hello';
  const result = sanitizeUserTextForLlm(input);
  assert.ok(result.removedTokens.includes('pizza'));
  assert.ok(!/\bpizza\b/i.test(result.sanitized));
  assert.match(result.sanitized, /\[EMPHASIS_REMOVED\]/);
});

test('does not remove protected domain token pack', () => {
  const input = 'pack pack pack when next pack';
  const result = sanitizeUserTextForLlm(input);
  assert.deepEqual(result.removedTokens, []);
  assert.equal(result.sanitized, input);
});

test('does not alter normal phrase like packing my bags', () => {
  const input = 'packing my bags';
  const result = sanitizeUserTextForLlm(input);
  assert.deepEqual(result.removedTokens, []);
  assert.equal(result.sanitized, input);
});

