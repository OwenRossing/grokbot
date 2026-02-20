import test from 'node:test';
import assert from 'node:assert/strict';

import { VisibilityCategory, resolveEphemeralVisibility } from '../src/services/visibilityPolicy.js';

test('shareable stats are public by default', () => {
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.SHAREABLE_STATS }),
    false
  );
});

test('private inventory is private by default and public when explicitly requested', () => {
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.PRIVATE_INVENTORY }),
    true
  );
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.PRIVATE_INVENTORY, isPublic: true }),
    false
  );
});

test('high-noise outputs are private by default and public when explicitly requested', () => {
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.HIGH_NOISE }),
    true
  );
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.HIGH_NOISE, isPublic: true }),
    false
  );
});

test('admin control outputs are always private', () => {
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.ADMIN_CONTROL }),
    true
  );
  assert.equal(
    resolveEphemeralVisibility({ category: VisibilityCategory.ADMIN_CONTROL, isPublic: true }),
    true
  );
});

test('forcePrivate overrides all categories', () => {
  assert.equal(
    resolveEphemeralVisibility({
      category: VisibilityCategory.SHAREABLE_STATS,
      forcePrivate: true,
    }),
    true
  );
});

