import test from 'node:test';
import assert from 'node:assert/strict';

import { getCopy } from '../src/copy.js';

function withTone(tone, fn) {
  const prev = process.env.BOT_TONE;
  if (tone === undefined) {
    delete process.env.BOT_TONE;
  } else {
    process.env.BOT_TONE = tone;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.BOT_TONE;
    else process.env.BOT_TONE = prev;
  }
}

test('professional is the default tone', () => {
  withTone(undefined, () => {
    assert.equal(
      getCopy('llm_fallback_error'),
      'I could not process that request right now due to an upstream API error.'
    );
  });
});

test('casual tone is opt-in via BOT_TONE=casual', () => {
  withTone('casual', () => {
    assert.equal(
      getCopy('llm_fallback_error'),
      'cant answer rn bro too busy gooning (grok api error)'
    );
  });
});

test('unknown keys return empty string', () => {
  withTone('professional', () => {
    assert.equal(getCopy('does_not_exist'), '');
  });
});

