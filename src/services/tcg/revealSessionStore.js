import crypto from 'node:crypto';
import { db } from '../../memory.js';

const DEFAULT_TTL_MS = Number.parseInt(process.env.TCG_REVEAL_SESSION_TTL_MS || '900000', 10);

function now() {
  return Date.now();
}

function generateId(prefix) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tcg_reveal_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    cards_json TEXT NOT NULL,
    current_index INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tcg_reveal_sessions_user ON tcg_reveal_sessions(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_tcg_reveal_sessions_expires ON tcg_reveal_sessions(expires_at);
`);

const insertSessionStmt = db.prepare(`
  INSERT INTO tcg_reveal_sessions (
    session_id, user_id, guild_id, channel_id, message_id, cards_json,
    current_index, expires_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getSessionStmt = db.prepare('SELECT * FROM tcg_reveal_sessions WHERE session_id = ?');
const updateSessionMessageStmt = db.prepare('UPDATE tcg_reveal_sessions SET message_id = ?, updated_at = ? WHERE session_id = ?');
const updateSessionIndexStmt = db.prepare('UPDATE tcg_reveal_sessions SET current_index = ?, updated_at = ? WHERE session_id = ?');
const deleteSessionStmt = db.prepare('DELETE FROM tcg_reveal_sessions WHERE session_id = ?');
const deleteExpiredSessionsStmt = db.prepare('DELETE FROM tcg_reveal_sessions WHERE expires_at < ?');

function normalizeSession(row) {
  if (!row) return null;
  return {
    ...row,
    cards: JSON.parse(row.cards_json || '[]'),
  };
}

export function createRevealSession({ userId, guildId, channelId, cards, ttlMs = DEFAULT_TTL_MS }) {
  const sessionId = generateId('reveal');
  const createdAt = now();
  const expiresAt = createdAt + Math.max(30000, ttlMs);
  insertSessionStmt.run(
    sessionId,
    userId,
    guildId || null,
    channelId,
    '',
    JSON.stringify(cards || []),
    0,
    expiresAt,
    createdAt,
    createdAt
  );
  return getRevealSession(sessionId);
}

export function getRevealSession(sessionId) {
  return normalizeSession(getSessionStmt.get(sessionId));
}

export function setRevealSessionMessage(sessionId, messageId) {
  updateSessionMessageStmt.run(messageId || '', now(), sessionId);
  return getRevealSession(sessionId);
}

export function advanceRevealSession(sessionId, direction = 1) {
  const session = getRevealSession(sessionId);
  if (!session) throw new Error('reveal session not found');
  if (session.expires_at < now()) {
    deleteSessionStmt.run(sessionId);
    throw new Error('reveal session expired');
  }
  const maxIndex = Math.max(0, session.cards.length - 1);
  const delta = direction < 0 ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(maxIndex, session.current_index + delta));
  updateSessionIndexStmt.run(nextIndex, now(), sessionId);
  return getRevealSession(sessionId);
}

export function deleteRevealSession(sessionId) {
  deleteSessionStmt.run(sessionId);
}

export function cleanupExpiredRevealSessions() {
  return deleteExpiredSessionsStmt.run(now()).changes || 0;
}
