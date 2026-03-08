import test from 'node:test';
import assert from 'node:assert/strict';

import { matchNaturalTcgCommand } from '../src/commands/naturalCommandRouter.js';

test('tcg natural routing is disabled for pack phrasing', () => {
  const phrases = [
    'how long until i can get a new pack',
    'claim my packs',
    'open next pack',
    'show my pack completion for sv1',
    'can you sell my duplicates on the market',
    'view my rarest card',
  ];

  for (const phrase of phrases) {
    const parsed = matchNaturalTcgCommand(phrase);
    assert.equal(parsed, null, `expected null parse for phrase: ${phrase}`);
  }
});
