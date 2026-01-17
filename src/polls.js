import { db } from './memory.js';

// Schema
// polls: id INTEGER PK, guild_id TEXT, channel_id TEXT, message_id TEXT, creator_id TEXT,
//        question TEXT, options_json TEXT, multi_vote INTEGER, anonymous INTEGER,
//        closes_at INTEGER, closed INTEGER, created_at INTEGER
// poll_votes: poll_id INTEGER, user_id TEXT, option_index INTEGER, created_at INTEGER,
//             PRIMARY KEY (poll_id, user_id)

db.exec(`
  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    multi_vote INTEGER DEFAULT 0,
    anonymous INTEGER DEFAULT 0,
    closes_at INTEGER NOT NULL,
    closed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id)
  );
`);

const insertPollStmt = db.prepare(`
  INSERT INTO polls (guild_id, channel_id, message_id, creator_id, question, options_json, multi_vote, anonymous, closes_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getPollByMessageIdStmt = db.prepare(`
  SELECT * FROM polls WHERE message_id = ?
`);
const getPollByIdStmt = db.prepare(`
  SELECT * FROM polls WHERE id = ?
`);
const listOpenPollsStmt = db.prepare(`
  SELECT * FROM polls WHERE closed = 0 AND closes_at > 0
`);
const markClosedStmt = db.prepare(`
  UPDATE polls SET closed = 1 WHERE id = ?
`);
const upsertVoteStmt = db.prepare(`
  INSERT INTO poll_votes (poll_id, user_id, option_index, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index, created_at = excluded.created_at
`);
const deleteVoteStmt = db.prepare(`
  DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?
`);
const tallyVotesStmt = db.prepare(`
  SELECT option_index, COUNT(*) as count
  FROM poll_votes
  WHERE poll_id = ?
  GROUP BY option_index
`);

export function createPoll({ guildId, channelId, messageId, creatorId, question, options, multiVote = false, anonymous = false, closesAt }) {
  const createdAt = Date.now();
  insertPollStmt.run(guildId || null, channelId, messageId, creatorId, question, JSON.stringify(options), multiVote ? 1 : 0, anonymous ? 1 : 0, closesAt, createdAt);
  const row = getPollByMessageIdStmt.get(messageId);
  return row;
}

export function getPollByMessageId(messageId) {
  return getPollByMessageIdStmt.get(messageId) || null;
}

export function getPollById(id) {
  return getPollByIdStmt.get(id) || null;
}

export function listOpenPolls() {
  return listOpenPollsStmt.all();
}

export function recordVote({ pollId, userId, optionIndex }) {
  upsertVoteStmt.run(pollId, userId, optionIndex, Date.now());
}

export function removeVote({ pollId, userId }) {
  deleteVoteStmt.run(pollId, userId);
}

export function tallyVotes(pollId, optionsLength) {
  const rows = tallyVotesStmt.all(pollId);
  const counts = Array(optionsLength).fill(0);
  for (const r of rows) {
    if (r.option_index >= 0 && r.option_index < optionsLength) counts[r.option_index] = r.count;
  }
  return counts;
}

export function closePoll(pollId) {
  markClosedStmt.run(pollId);
}
