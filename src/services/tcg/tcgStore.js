import crypto from 'node:crypto';
import { db } from '../../memory.js';

const FREE_PACK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CREDITS_PER_OPEN = 25;
const DEFAULT_STREAK_BONUS = 10;
const MAX_STREAK_DAYS = 7;

function now() {
  return Date.now();
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function generateId(prefix) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

export function parseCsvIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function rarityToTier(rarity = '') {
  const r = String(rarity).toLowerCase();
  if (!r) return 1;
  if (r.includes('secret') || r.includes('hyper') || r.includes('illustration rare') || r.includes('special')) return 6;
  if (r.includes('ultra') || r.includes('rainbow')) return 5;
  if (r.includes('rare holo') || r.includes('double rare')) return 4;
  if (r.includes('rare')) return 3;
  if (r.includes('uncommon')) return 2;
  return 1;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tcg_sets (
    set_code TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    release_date TEXT NOT NULL DEFAULT '',
    pack_profile_json TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_cards (
    card_id TEXT PRIMARY KEY,
    set_code TEXT NOT NULL,
    name TEXT NOT NULL,
    rarity TEXT NOT NULL DEFAULT '',
    rarity_tier INTEGER NOT NULL DEFAULT 1,
    supertype TEXT NOT NULL DEFAULT '',
    image_small TEXT NOT NULL DEFAULT '',
    image_large TEXT NOT NULL DEFAULT '',
    market_price_usd REAL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_pack_profiles (
    product_code TEXT PRIMARY KEY,
    set_code TEXT NOT NULL,
    slots_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tcg_user_wallets (
    user_id TEXT PRIMARY KEY,
    credits INTEGER NOT NULL DEFAULT 0,
    opened_count INTEGER NOT NULL DEFAULT 0,
    streak_days INTEGER NOT NULL DEFAULT 0,
    last_open_at INTEGER NOT NULL DEFAULT 0,
    last_free_pack_at INTEGER NOT NULL DEFAULT 0,
    last_streak_day TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tcg_card_instances (
    instance_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    minted_at INTEGER NOT NULL,
    mint_source TEXT NOT NULL,
    mint_batch_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'owned',
    lock_trade_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tcg_open_events (
    open_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    set_code TEXT NOT NULL,
    product_code TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS tcg_trades (
    trade_id TEXT PRIMARY KEY,
    guild_id TEXT,
    channel_id TEXT,
    offered_by_user_id TEXT NOT NULL,
    offered_to_user_id TEXT NOT NULL,
    offer_cards_json TEXT NOT NULL DEFAULT '[]',
    request_cards_json TEXT NOT NULL DEFAULT '[]',
    offer_credits INTEGER NOT NULL DEFAULT 0,
    request_credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_ledger (
    entry_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    delta_credits INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_admin_events (
    event_id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tcg_cards_set_code ON tcg_cards(set_code);
  CREATE INDEX IF NOT EXISTS idx_tcg_cards_rarity_tier ON tcg_cards(set_code, rarity_tier);
  CREATE INDEX IF NOT EXISTS idx_tcg_instances_owner ON tcg_card_instances(owner_user_id, state);
  CREATE INDEX IF NOT EXISTS idx_tcg_trades_offer_to ON tcg_trades(offered_to_user_id, status);
`);

const upsertSetStmt = db.prepare(`
  INSERT INTO tcg_sets (set_code, name, release_date, pack_profile_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(set_code) DO UPDATE SET
    name = excluded.name,
    release_date = excluded.release_date,
    pack_profile_json = excluded.pack_profile_json,
    updated_at = excluded.updated_at
`);

const upsertCardStmt = db.prepare(`
  INSERT INTO tcg_cards (card_id, set_code, name, rarity, rarity_tier, supertype, image_small, image_large, market_price_usd, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(card_id) DO UPDATE SET
    set_code = excluded.set_code,
    name = excluded.name,
    rarity = excluded.rarity,
    rarity_tier = excluded.rarity_tier,
    supertype = excluded.supertype,
    image_small = excluded.image_small,
    image_large = excluded.image_large,
    market_price_usd = excluded.market_price_usd,
    updated_at = excluded.updated_at
`);

const upsertPackProfileStmt = db.prepare(`
  INSERT INTO tcg_pack_profiles (product_code, set_code, slots_json, is_active)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(product_code) DO UPDATE SET
    set_code = excluded.set_code,
    slots_json = excluded.slots_json,
    is_active = excluded.is_active
`);

const getSetStmt = db.prepare('SELECT set_code, name, release_date, pack_profile_json, updated_at FROM tcg_sets WHERE set_code = ?');
const getCardsBySetStmt = db.prepare('SELECT * FROM tcg_cards WHERE set_code = ?');
const getPackProfileStmt = db.prepare('SELECT product_code, set_code, slots_json, is_active FROM tcg_pack_profiles WHERE product_code = ? AND is_active = 1');
const getWalletStmt = db.prepare('SELECT * FROM tcg_user_wallets WHERE user_id = ?');
const upsertWalletStmt = db.prepare(`
  INSERT INTO tcg_user_wallets (user_id, credits, opened_count, streak_days, last_open_at, last_free_pack_at, last_streak_day)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    credits = excluded.credits,
    opened_count = excluded.opened_count,
    streak_days = excluded.streak_days,
    last_open_at = excluded.last_open_at,
    last_free_pack_at = excluded.last_free_pack_at,
    last_streak_day = excluded.last_streak_day
`);
const setSettingStmt = db.prepare(`
  INSERT INTO tcg_settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const getSettingStmt = db.prepare('SELECT value FROM tcg_settings WHERE key = ?');
const insertLedgerStmt = db.prepare(`
  INSERT INTO tcg_ledger (entry_id, user_id, delta_credits, reason, ref_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertOpenEventStmt = db.prepare(`
  INSERT INTO tcg_open_events (open_id, user_id, guild_id, set_code, product_code, result_json, created_at, idempotency_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOpenByIdempotencyStmt = db.prepare('SELECT * FROM tcg_open_events WHERE idempotency_key = ?');
const insertInstanceStmt = db.prepare(`
  INSERT INTO tcg_card_instances (instance_id, card_id, owner_user_id, minted_at, mint_source, mint_batch_id, state, lock_trade_id)
  VALUES (?, ?, ?, ?, ?, ?, 'owned', '')
`);
const getInventoryPageStmt = db.prepare(`
  SELECT i.instance_id, i.card_id, i.owner_user_id, i.minted_at, i.state, c.name, c.rarity, c.rarity_tier, c.set_code, c.image_small, c.image_large, c.market_price_usd
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND (? = '' OR c.set_code = ?)
    AND (? = '' OR c.name LIKE ?)
  ORDER BY i.minted_at DESC
  LIMIT ? OFFSET ?
`);
const countInventoryStmt = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND (? = '' OR c.set_code = ?)
    AND (? = '' OR c.name LIKE ?)
`);
const getInstanceByIdStmt = db.prepare(`
  SELECT i.instance_id, i.card_id, i.owner_user_id, i.state, i.lock_trade_id, c.name, c.rarity, c.rarity_tier, c.set_code
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.instance_id = ?
`);
const lockInstanceStmt = db.prepare(`
  UPDATE tcg_card_instances
  SET state = 'trade_locked', lock_trade_id = ?
  WHERE instance_id = ? AND owner_user_id = ? AND state = 'owned'
`);
const unlockInstanceByTradeStmt = db.prepare(`
  UPDATE tcg_card_instances
  SET state = 'owned', lock_trade_id = ''
  WHERE lock_trade_id = ? AND state = 'trade_locked'
`);
const transferOwnedInstanceStmt = db.prepare(`
  UPDATE tcg_card_instances
  SET owner_user_id = ?, state = 'owned', lock_trade_id = ''
  WHERE instance_id = ? AND owner_user_id = ? AND (state = 'owned' OR state = 'trade_locked')
`);
const insertTradeStmt = db.prepare(`
  INSERT INTO tcg_trades (trade_id, guild_id, channel_id, offered_by_user_id, offered_to_user_id, offer_cards_json, request_cards_json, offer_credits, request_credits, status, expires_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTradeStatusStmt = db.prepare(`
  UPDATE tcg_trades
  SET status = ?, updated_at = ?
  WHERE trade_id = ? AND status = ?
`);
const getTradeStmt = db.prepare('SELECT * FROM tcg_trades WHERE trade_id = ?');
const listTradesForUserStmt = db.prepare(`
  SELECT * FROM tcg_trades
  WHERE (offered_by_user_id = ? OR offered_to_user_id = ?)
  ORDER BY created_at DESC
  LIMIT 20
`);
const listAdminEventsStmt = db.prepare('SELECT * FROM tcg_admin_events ORDER BY created_at DESC LIMIT ?');
const insertAdminEventStmt = db.prepare(`
  INSERT INTO tcg_admin_events (event_id, admin_user_id, action, payload_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

function getWalletInternal(userId) {
  const row = getWalletStmt.get(userId);
  if (row) return row;
  const next = {
    user_id: userId,
    credits: 0,
    opened_count: 0,
    streak_days: 0,
    last_open_at: 0,
    last_free_pack_at: 0,
    last_streak_day: '',
  };
  upsertWalletStmt.run(
    next.user_id,
    next.credits,
    next.opened_count,
    next.streak_days,
    next.last_open_at,
    next.last_free_pack_at,
    next.last_streak_day
  );
  return next;
}

export function getWallet(userId) {
  return getWalletInternal(userId);
}

export function getTcgSetting(key, fallback = '') {
  const row = getSettingStmt.get(key);
  return row?.value ?? fallback;
}

export function setTcgSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

export function ensureDefaultTcgSettings() {
  if (!getSettingStmt.get('credit_multiplier')) setSettingStmt.run('credit_multiplier', '1');
  if (!getSettingStmt.get('drop_rate_event_multiplier')) setSettingStmt.run('drop_rate_event_multiplier', '1');
  if (!getSettingStmt.get('trade_locked')) setSettingStmt.run('trade_locked', '0');
}

ensureDefaultTcgSettings();

export function upsertSet({ setCode, name = '', releaseDate = '', packProfileJson = '' }) {
  upsertSetStmt.run(setCode, name, releaseDate, packProfileJson, now());
}

export function upsertCard(card) {
  const tier = rarityToTier(card.rarity);
  upsertCardStmt.run(
    card.cardId,
    card.setCode,
    card.name || 'Unknown Card',
    card.rarity || '',
    tier,
    card.supertype || '',
    card.imageSmall || '',
    card.imageLarge || '',
    Number.isFinite(card.marketPriceUsd) ? card.marketPriceUsd : null,
    now()
  );
}

export function upsertPackProfile({ productCode, setCode, slots }) {
  upsertPackProfileStmt.run(productCode, setCode, JSON.stringify(slots || []), 1);
}

export function getSet(setCode) {
  return getSetStmt.get(setCode) || null;
}

export function getCardsBySet(setCode) {
  return getCardsBySetStmt.all(setCode);
}

export function getPackProfile(productCode) {
  const row = getPackProfileStmt.get(productCode);
  if (!row) return null;
  return {
    ...row,
    slots: JSON.parse(row.slots_json || '[]'),
  };
}

function addCreditsInternal(userId, delta, reason, refId = '') {
  const wallet = getWalletInternal(userId);
  const nextCredits = wallet.credits + delta;
  if (nextCredits < 0) {
    throw new Error('insufficient credits');
  }
  const updated = {
    ...wallet,
    credits: nextCredits,
  };
  upsertWalletStmt.run(
    updated.user_id,
    updated.credits,
    updated.opened_count,
    updated.streak_days,
    updated.last_open_at,
    updated.last_free_pack_at,
    updated.last_streak_day
  );
  insertLedgerStmt.run(generateId('ledger'), userId, delta, reason, refId, now());
  return updated;
}

export const addCredits = db.transaction((userId, delta, reason, refId = '') =>
  addCreditsInternal(userId, delta, reason, refId)
);

function applyOpenRewardsInternal(userId, openRef) {
  const wallet = getWalletInternal(userId);
  const currentDay = dayKey();
  let streakDays = wallet.streak_days || 0;
  if (!wallet.last_streak_day) {
    streakDays = 1;
  } else {
    const last = new Date(`${wallet.last_streak_day}T00:00:00.000Z`).getTime();
    const cur = new Date(`${currentDay}T00:00:00.000Z`).getTime();
    const diff = Math.round((cur - last) / (24 * 60 * 60 * 1000));
    if (diff === 0) {
      streakDays = wallet.streak_days || 1;
    } else if (diff === 1) {
      streakDays = Math.min(MAX_STREAK_DAYS, (wallet.streak_days || 0) + 1);
    } else {
      streakDays = 1;
    }
  }

  const multiplier = Number.parseFloat(getTcgSetting('credit_multiplier', '1')) || 1;
  const base = Math.max(0, Math.round(DEFAULT_CREDITS_PER_OPEN * multiplier));
  const streakBonus = Math.max(0, Math.round(DEFAULT_STREAK_BONUS * multiplier * Math.max(0, streakDays - 1)));
  const earned = base + streakBonus;

  const updated = {
    ...wallet,
    credits: wallet.credits + earned,
    opened_count: (wallet.opened_count || 0) + 1,
    last_open_at: now(),
    last_free_pack_at: now(),
    last_streak_day: currentDay,
    streak_days: streakDays,
  };
  upsertWalletStmt.run(
    updated.user_id,
    updated.credits,
    updated.opened_count,
    updated.streak_days,
    updated.last_open_at,
    updated.last_free_pack_at,
    updated.last_streak_day
  );
  insertLedgerStmt.run(generateId('ledger'), userId, earned, 'pack_open_reward', openRef, now());
  return { wallet: updated, earned, base, streakBonus };
}

export function getFreePackAvailability(userId) {
  const wallet = getWalletInternal(userId);
  const nextAt = (wallet.last_free_pack_at || 0) + FREE_PACK_COOLDOWN_MS;
  const availableInMs = Math.max(0, nextAt - now());
  return { available: availableInMs === 0, availableInMs, nextAt };
}

export const createOpenWithMint = db.transaction(({
  idempotencyKey,
  userId,
  guildId,
  setCode,
  productCode,
  pulls,
}) => {
  const existing = getOpenByIdempotencyStmt.get(idempotencyKey);
  if (existing) {
    return {
      reused: true,
      openId: existing.open_id,
      result: JSON.parse(existing.result_json || '{}'),
      rewards: null,
    };
  }

  const openId = generateId('open');
  const batchId = generateId('mint');
  const mintedAt = now();
  const minted = [];
  for (const card of pulls) {
    const instanceId = generateId('ci');
    insertInstanceStmt.run(instanceId, card.card_id, userId, mintedAt, 'pack_open', batchId);
    minted.push({
      instance_id: instanceId,
      card_id: card.card_id,
      name: card.name,
      rarity: card.rarity,
      rarity_tier: card.rarity_tier,
      set_code: card.set_code,
      image_large: card.image_large,
      image_small: card.image_small,
      market_price_usd: card.market_price_usd,
    });
  }

  const rewards = applyOpenRewardsInternal(userId, openId);
  const payload = { minted, rewards };
  insertOpenEventStmt.run(openId, userId, guildId || null, setCode, productCode, JSON.stringify(payload), now(), idempotencyKey);

  return { reused: false, openId, result: payload, rewards };
});

export function getInventoryPage({ userId, page = 1, pageSize = 10, setCode = '', nameLike = '' }) {
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, Math.min(25, pageSize));
  const offset = (safePage - 1) * safeSize;
  const like = nameLike ? `%${nameLike}%` : '';
  const rows = getInventoryPageStmt.all(userId, setCode, setCode, like, like, safeSize, offset);
  const total = countInventoryStmt.get(userId, setCode, setCode, like, like)?.cnt || 0;
  return {
    rows,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

function setTradeStatusOrThrow(tradeId, fromStatus, toStatus) {
  const result = updateTradeStatusStmt.run(toStatus, now(), tradeId, fromStatus);
  if (result.changes !== 1) {
    throw new Error(`trade status transition failed (${fromStatus} -> ${toStatus})`);
  }
}

export const createTradeOffer = db.transaction(({
  guildId,
  channelId,
  offeredByUserId,
  offeredToUserId,
  offerCardIds,
  requestCardIds,
  offerCredits = 0,
  requestCredits = 0,
  expiresAt,
}) => {
  if (getTcgSetting('trade_locked', '0') === '1') {
    throw new Error('trading is temporarily locked by admin');
  }
  if (!Array.isArray(offerCardIds) || offerCardIds.length === 0) {
    throw new Error('offer must include at least one card');
  }
  if (offerCredits < 0 || requestCredits < 0) {
    throw new Error('credits must be non-negative');
  }

  if (offerCredits > 0) {
    const wallet = getWalletInternal(offeredByUserId);
    if (wallet.credits < offerCredits) {
      throw new Error('insufficient credits for offer');
    }
  }

  const tradeId = generateId('trade');
  for (const instanceId of offerCardIds) {
    const result = lockInstanceStmt.run(tradeId, instanceId, offeredByUserId);
    if (result.changes !== 1) {
      throw new Error(`could not lock offered card ${instanceId}`);
    }
  }

  if (offerCredits > 0) {
    addCreditsInternal(offeredByUserId, -offerCredits, 'trade_reserve', tradeId);
  }

  insertTradeStmt.run(
    tradeId,
    guildId || null,
    channelId || null,
    offeredByUserId,
    offeredToUserId,
    JSON.stringify(offerCardIds),
    JSON.stringify(requestCardIds || []),
    offerCredits,
    requestCredits,
    'pending',
    expiresAt,
    now(),
    now()
  );

  return getTradeStmt.get(tradeId);
});

export const cancelOrRejectTrade = db.transaction((tradeId, expectedStatus, nextStatus) => {
  const trade = getTradeStmt.get(tradeId);
  if (!trade) throw new Error('trade not found');
  if (trade.status !== expectedStatus) throw new Error(`trade is ${trade.status}`);
  setTradeStatusOrThrow(tradeId, expectedStatus, nextStatus);
  unlockInstanceByTradeStmt.run(tradeId);
  if ((trade.offer_credits || 0) > 0) {
    addCreditsInternal(trade.offered_by_user_id, trade.offer_credits, 'trade_release', tradeId);
  }
  return getTradeStmt.get(tradeId);
});

export const settleTrade = db.transaction((tradeId, accepterUserId) => {
  const trade = getTradeStmt.get(tradeId);
  if (!trade) throw new Error('trade not found');
  if (trade.status !== 'pending') throw new Error(`trade is ${trade.status}`);
  if (trade.offered_to_user_id !== accepterUserId) throw new Error('only target user can accept this trade');
  if ((trade.expires_at || 0) < now()) throw new Error('trade expired');

  const offerCards = JSON.parse(trade.offer_cards_json || '[]');
  const requestCards = JSON.parse(trade.request_cards_json || '[]');

  for (const instanceId of offerCards) {
    const row = getInstanceByIdStmt.get(instanceId);
    if (!row) throw new Error(`missing offered card ${instanceId}`);
    if (row.owner_user_id !== trade.offered_by_user_id) throw new Error(`offered card ownership changed: ${instanceId}`);
    if (row.state !== 'trade_locked' || row.lock_trade_id !== tradeId) throw new Error(`offered card not locked: ${instanceId}`);
  }

  for (const instanceId of requestCards) {
    const row = getInstanceByIdStmt.get(instanceId);
    if (!row) throw new Error(`missing requested card ${instanceId}`);
    if (row.owner_user_id !== trade.offered_to_user_id || row.state !== 'owned') {
      throw new Error(`requested card unavailable: ${instanceId}`);
    }
  }

  if ((trade.request_credits || 0) > 0) {
    const targetWallet = getWalletInternal(trade.offered_to_user_id);
    if (targetWallet.credits < trade.request_credits) {
      throw new Error('target user does not have enough credits');
    }
  }

  for (const instanceId of offerCards) {
    const moved = transferOwnedInstanceStmt.run(trade.offered_to_user_id, instanceId, trade.offered_by_user_id);
    if (moved.changes !== 1) throw new Error(`failed transferring offered card ${instanceId}`);
  }
  for (const instanceId of requestCards) {
    const moved = transferOwnedInstanceStmt.run(trade.offered_by_user_id, instanceId, trade.offered_to_user_id);
    if (moved.changes !== 1) throw new Error(`failed transferring requested card ${instanceId}`);
  }

  if ((trade.offer_credits || 0) > 0) {
    addCreditsInternal(trade.offered_to_user_id, trade.offer_credits, 'trade_receive', tradeId);
  }
  if ((trade.request_credits || 0) > 0) {
    addCreditsInternal(trade.offered_to_user_id, -trade.request_credits, 'trade_pay', tradeId);
    addCreditsInternal(trade.offered_by_user_id, trade.request_credits, 'trade_receive', tradeId);
  }

  setTradeStatusOrThrow(tradeId, 'pending', 'settled');
  return getTradeStmt.get(tradeId);
});

export function getTrade(tradeId) {
  return getTradeStmt.get(tradeId) || null;
}

export function listTradesForUser(userId) {
  return listTradesForUserStmt.all(userId, userId);
}

export function expirePendingTradeIfNeeded(tradeId) {
  const trade = getTradeStmt.get(tradeId);
  if (!trade || trade.status !== 'pending') return trade;
  if ((trade.expires_at || 0) > now()) return trade;
  return cancelOrRejectTrade(tradeId, 'pending', 'expired');
}

export function getCardInstance(instanceId) {
  return getInstanceByIdStmt.get(instanceId) || null;
}

export function getCardById(cardId) {
  return db.prepare('SELECT * FROM tcg_cards WHERE card_id = ?').get(cardId) || null;
}

export function getCardValue(card) {
  if (card?.market_price_usd && Number.isFinite(card.market_price_usd)) {
    return { valueUsd: Number(card.market_price_usd), source: 'market' };
  }
  const tier = Number(card?.rarity_tier || 1);
  if (tier >= 6) return { valueUsd: 6.0, source: 'rarity_fallback' };
  if (tier === 5) return { valueUsd: 3.0, source: 'rarity_fallback' };
  if (tier === 4) return { valueUsd: 1.5, source: 'rarity_fallback' };
  if (tier === 3) return { valueUsd: 1.0, source: 'rarity_fallback' };
  if (tier === 2) return { valueUsd: 0.25, source: 'rarity_fallback' };
  return { valueUsd: 0.1, source: 'rarity_fallback' };
}

export function grantAdminCredits(adminUserId, userId, delta, reason = 'admin_grant_credits') {
  const updated = addCredits(userId, delta, reason, adminUserId);
  insertAdminEventStmt.run(generateId('admin'), adminUserId, 'grant_credits', JSON.stringify({ userId, delta, reason }), now());
  return updated;
}

export function grantAdminCards(adminUserId, userId, cardIds = [], source = 'admin_grant') {
  const mintedAt = now();
  const batchId = generateId('mint');
  const minted = [];
  const tx = db.transaction(() => {
    for (const cardId of cardIds) {
      const card = getCardById(cardId);
      if (!card) throw new Error(`unknown card id: ${cardId}`);
      const instanceId = generateId('ci');
      insertInstanceStmt.run(instanceId, cardId, userId, mintedAt, source, batchId);
      minted.push({ instanceId, cardId, name: card.name, rarity: card.rarity });
    }
    insertAdminEventStmt.run(generateId('admin'), adminUserId, 'grant_cards', JSON.stringify({ userId, cardIds }), now());
  });
  tx();
  return minted;
}

export function setTradeLocked(adminUserId, enabled) {
  setTcgSetting('trade_locked', enabled ? '1' : '0');
  insertAdminEventStmt.run(generateId('admin'), adminUserId, 'trade_lock', JSON.stringify({ enabled: !!enabled }), now());
}

export function listAdminEvents(limit = 20) {
  return listAdminEventsStmt.all(Math.max(1, Math.min(100, limit)));
}

export function setAdminMultiplier(adminUserId, key, value) {
  if (!['credit_multiplier', 'drop_rate_event_multiplier'].includes(key)) {
    throw new Error('unknown multiplier key');
  }
  setTcgSetting(key, value);
  insertAdminEventStmt.run(generateId('admin'), adminUserId, 'set_multiplier', JSON.stringify({ key, value }), now());
}

export function getTcgOverview(userId) {
  const wallet = getWalletInternal(userId);
  const invCount = db.prepare('SELECT COUNT(*) AS cnt FROM tcg_card_instances WHERE owner_user_id = ?').get(userId)?.cnt || 0;
  return {
    wallet,
    inventoryCount: invCount,
    cooldown: getFreePackAvailability(userId),
    tradeLocked: getTcgSetting('trade_locked', '0') === '1',
  };
}

