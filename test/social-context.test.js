import test from 'node:test';
import assert from 'node:assert/strict';

import { addTurn } from '../src/handlers/handlePrompt.js';
import {
  buildConversationTurnKey,
  buildReplyContextBlock,
  buildReplySearchText,
} from '../src/services/socialContext.js';

test('conversation turn key is scoped by guild channel and user', () => {
  const first = buildConversationTurnKey({
    channelType: 'guild',
    guildId: 'guild1',
    channelId: 'channel1',
    userId: 'user1',
  });
  const second = buildConversationTurnKey({
    channelType: 'guild',
    guildId: 'guild1',
    channelId: 'channel2',
    userId: 'user1',
  });
  const third = buildConversationTurnKey({
    channelType: 'guild',
    guildId: 'guild1',
    channelId: 'channel1',
    userId: 'user2',
  });

  assert.notEqual(first, second);
  assert.notEqual(first, third);
});

test('addTurn keeps recent turns isolated by conversation key', () => {
  const turns = new Map();
  addTurn(turns, 'guild:a:b:user1', 'user', 'hello from one');
  addTurn(turns, 'guild:a:b:user2', 'user', 'hello from two');

  assert.equal(turns.get('guild:a:b:user1').length, 1);
  assert.equal(turns.get('guild:a:b:user1')[0].content, 'hello from one');
  assert.equal(turns.get('guild:a:b:user2')[0].content, 'hello from two');
});

test('reply context block preserves speaker attribution', () => {
  const block = buildReplyContextBlock({
    authorId: 'alice',
    authorDisplayName: 'Alice',
    text: 'we should ship the fix tonight',
    messages: [
      {
        authorId: 'alice',
        authorDisplayName: 'Alice',
        text: 'we should ship the fix tonight',
        isReferenceTarget: true,
      },
      {
        authorId: 'owen',
        authorDisplayName: 'Owen',
        text: '@grok what do you think',
      },
    ],
  }, {
    id: 'owen',
    displayName: 'Owen',
  });

  assert.match(block, /Replied-to author: Alice/);
  assert.match(block, /Replied-to author is current speaker: no/);
  assert.match(block, /Alice \[replied-to message\]: we should ship the fix tonight/);
});

test('reply search text stays compact and includes reply target', () => {
  const text = buildReplySearchText({
    authorDisplayName: 'Alice',
    text: 'ship the fix tonight',
  });

  assert.equal(text, 'Reply target: Alice ship the fix tonight');
});
