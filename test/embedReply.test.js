import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmbed, ensureEmbedPayload } from '../src/utils/embedReply.js';

test('buildEmbed returns embed with description', () => {
  const embed = buildEmbed({
    title: 'Test Title',
    description: 'Hello world',
  });
  assert.equal(embed.title, 'Test Title');
  assert.equal(embed.description, 'Hello world');
  assert.ok(Array.isArray(embed.fields));
});

test('ensureEmbedPayload converts plain content into embeds', () => {
  const payload = ensureEmbedPayload(
    { content: 'Primary output body' },
    { defaultTitle: 'Command Result', source: 'test' }
  );
  assert.equal(payload.content, '');
  assert.ok(Array.isArray(payload.embeds));
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].description, 'Primary output body');
});

test('ensureEmbedPayload adds txt attachment on overflow', () => {
  const big = 'A'.repeat(5000);
  const payload = ensureEmbedPayload(
    { content: big },
    { defaultTitle: 'Command Result', source: 'test' }
  );
  assert.ok(Array.isArray(payload.embeds));
  assert.equal(payload.embeds.length, 1);
  assert.ok(payload.embeds[0].description.length <= 4096);
  assert.ok(Array.isArray(payload.files));
  assert.ok(payload.files.length >= 1);
  assert.equal(payload.files[0].name, 'details.txt');
});

