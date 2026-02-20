import test from 'node:test';
import assert from 'node:assert/strict';

import { matchNaturalTcgCommand } from '../src/commands/naturalCommandRouter.js';

test('routes cooldown question phrases to pack_cooldown_status', () => {
  const phrases = [
    'how long until i can get a new pack',
    'when is my next pack',
    'when can i claim again',
    'next free pack?',
    'when is my next free booster',
    'how long until next free pack',
    'when can i get another pack',
    'is a new pack available yet',
    'how long until pack is available',
    'next pack when',
    'when can i claim my pack again',
  ];

  for (const phrase of phrases) {
    const parsed = matchNaturalTcgCommand(phrase);
    assert.ok(parsed, `expected parse for phrase: ${phrase}`);
    assert.equal(parsed.action, 'pack_cooldown_status', `expected cooldown action for: ${phrase}`);
  }
});

test('does not route non-TCG pack idioms', () => {
  const phrases = [
    'pack it up boys',
    'i am packing my bags right now',
    'we are packing our bags tomorrow',
  ];

  for (const phrase of phrases) {
    const parsed = matchNaturalTcgCommand(phrase);
    assert.equal(parsed, null, `expected null parse for phrase: ${phrase}`);
  }
});

test('keeps existing pack actions for generic claim/open intents', () => {
  const claim = matchNaturalTcgCommand('claim my packs');
  assert.ok(claim);
  assert.equal(claim.action, 'claim_all_packs');

  const open = matchNaturalTcgCommand('open my packs');
  assert.ok(open);
  assert.equal(open.action, 'open_pack');
});

test('routes completion asks to pack_completion', () => {
  const parsed = matchNaturalTcgCommand('show my pack completion for sv1');
  assert.ok(parsed);
  assert.equal(parsed.action, 'pack_completion');
});

test('routes market duplicate sell phrase deterministically', () => {
  const parsed = matchNaturalTcgCommand('can you sell my duplicates on the market');
  assert.ok(parsed);
  assert.equal(parsed.action, 'market_sell_duplicates');
});

test('routes market usage help phrase deterministically', () => {
  const parsed = matchNaturalTcgCommand('how do i use the market');
  assert.ok(parsed);
  assert.equal(parsed.action, 'market_help');
});

test('routes claim/open macro phrase deterministically', () => {
  const parsed = matchNaturalTcgCommand('claim all my packs and open one');
  assert.ok(parsed);
  assert.equal(parsed.action, 'claim_all_and_open_one');
});

test('routes claim-all and open-next intents', () => {
  const claimAll = matchNaturalTcgCommand('claim all my packs');
  assert.ok(claimAll);
  assert.equal(claimAll.action, 'claim_all_packs');

  const openNext = matchNaturalTcgCommand('open next pack');
  assert.ok(openNext);
  assert.equal(openNext.action, 'open_next_pack');
});

test('routes rarest card view intent', () => {
  const parsed = matchNaturalTcgCommand('view my rarest card');
  assert.ok(parsed);
  assert.equal(parsed.action, 'view_rarest_card');
});
