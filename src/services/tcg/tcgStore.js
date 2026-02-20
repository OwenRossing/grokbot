import crypto from 'node:crypto';
import { db } from '../../memory.js';

const DEFAULT_FREE_PACK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FREE_PACK_COOLDOWN_MS = (() => {
  const parsed = Number.parseInt(process.env.TCG_FREE_PACK_COOLDOWN_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) return DEFAULT_FREE_PACK_COOLDOWN_MS;
  return Math.min(parsed, 30 * 24 * 60 * 60 * 1000);
})();
const DEFAULT_CREDITS_PER_OPEN = 25;
const DEFAULT_STREAK_BONUS = 10;
const MAX_STREAK_DAYS = 7;
const AUTO_CLAIM_DEFAULT_SET = String(process.env.TCG_DEFAULT_SET_CODE || 'sv1').trim().toLowerCase() || 'sv1';
const MARKET_CREDITS_PER_USD = Number.parseFloat(process.env.TCG_MARKET_CREDITS_PER_USD || '100') || 100;
const MARKET_BUY_MULT = Number.parseFloat(process.env.TCG_MARKET_BUY_MULT || '1.25') || 1.25;
const MARKET_SELL_MULT = Number.parseFloat(process.env.TCG_MARKET_SELL_MULT || '0.60') || 0.6;
const MARKET_BUY_FLOOR = Math.max(1, Number.parseInt(process.env.TCG_MARKET_BUY_FLOOR || '10', 10) || 10);
const MARKET_SELL_FLOOR = Math.max(1, Number.parseInt(process.env.TCG_MARKET_SELL_FLOOR || '5', 10) || 5);
export const TRADE_IN_CREDITS_BY_RARITY_TIER = Object.freeze({
  1: 2,
  2: 4,
  3: 8,
  4: 16,
  5: 32,
  6: 64,
});

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
    logo_image_url TEXT NOT NULL DEFAULT '',
    symbol_image_url TEXT NOT NULL DEFAULT '',
    pack_preview_image_url TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS tcg_pack_profile_versions (
    product_code TEXT NOT NULL,
    version INTEGER NOT NULL,
    set_code TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    PRIMARY KEY (product_code, version)
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
    profile_version TEXT NOT NULL DEFAULT '',
    drop_audit_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS tcg_pity_state (
    user_id TEXT NOT NULL,
    product_code TEXT NOT NULL,
    pity_key TEXT NOT NULL,
    open_count_since_hit INTEGER NOT NULL DEFAULT 0,
    last_hit_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, product_code, pity_key)
  );

  CREATE TABLE IF NOT EXISTS tcg_drop_audit (
    open_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    product_code TEXT NOT NULL,
    profile_version TEXT NOT NULL DEFAULT '',
    audit_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_claimable_packs (
    pack_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    granted_by_user_id TEXT NOT NULL,
    set_code TEXT NOT NULL,
    product_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimable',
    grant_source TEXT NOT NULL DEFAULT 'admin_grant',
    grant_meta_json TEXT NOT NULL DEFAULT '{}',
    granted_at INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL DEFAULT 0,
    open_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tcg_user_settings (
    user_id TEXT PRIMARY KEY,
    auto_claim_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
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

  CREATE TABLE IF NOT EXISTS tcg_live_events (
    event_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    effect_type TEXT NOT NULL,
    effect_value TEXT NOT NULL,
    set_scope TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_market_catalog (
    card_id TEXT PRIMARY KEY,
    buy_price_credits INTEGER NOT NULL,
    sell_price_credits INTEGER NOT NULL,
    price_source TEXT NOT NULL DEFAULT 'formula',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tcg_market_orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    side TEXT NOT NULL,
    card_id TEXT NOT NULL DEFAULT '',
    instance_id TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price_credits INTEGER NOT NULL DEFAULT 0,
    total_credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    settled_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tcg_inventory_stats (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    owned_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tcg_cards_set_code ON tcg_cards(set_code);
  CREATE INDEX IF NOT EXISTS idx_tcg_cards_rarity_tier ON tcg_cards(set_code, rarity_tier);
  CREATE INDEX IF NOT EXISTS idx_tcg_instances_owner ON tcg_card_instances(owner_user_id, state);
  CREATE INDEX IF NOT EXISTS idx_tcg_instances_owner_card_state ON tcg_card_instances(owner_user_id, card_id, state);
  CREATE INDEX IF NOT EXISTS idx_tcg_open_events_user_created ON tcg_open_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tcg_trades_offer_to ON tcg_trades(offered_to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_tcg_claimable_packs_owner_status ON tcg_claimable_packs(owner_user_id, status, granted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tcg_pity_user_product ON tcg_pity_state(user_id, product_code);
  CREATE INDEX IF NOT EXISTS idx_tcg_drop_audit_open_id ON tcg_drop_audit(open_id);
  CREATE INDEX IF NOT EXISTS idx_tcg_live_events_status_time ON tcg_live_events(status, start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_tcg_live_events_effect_status ON tcg_live_events(effect_type, status, start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_tcg_live_events_scope_status ON tcg_live_events(set_scope, status, start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_tcg_market_orders_user_created ON tcg_market_orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tcg_market_catalog_enabled_price ON tcg_market_catalog(is_enabled, buy_price_credits, sell_price_credits);
`);

function isDuplicateColumnError(error) {
  return (
    error &&
    typeof error.message === 'string' &&
    error.message.includes('duplicate column name')
  );
}

try {
  db.exec("ALTER TABLE tcg_claimable_packs ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'admin_grant'");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_claimable_packs ADD COLUMN grant_meta_json TEXT NOT NULL DEFAULT '{}'");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec('ALTER TABLE tcg_claimable_packs ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_sets ADD COLUMN logo_image_url TEXT NOT NULL DEFAULT ''");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_sets ADD COLUMN symbol_image_url TEXT NOT NULL DEFAULT ''");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_sets ADD COLUMN pack_preview_image_url TEXT NOT NULL DEFAULT ''");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_open_events ADD COLUMN profile_version TEXT NOT NULL DEFAULT ''");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
try {
  db.exec("ALTER TABLE tcg_open_events ADD COLUMN drop_audit_json TEXT NOT NULL DEFAULT '{}'");
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}

const upsertSetStmt = db.prepare(`
  INSERT INTO tcg_sets (
    set_code, name, release_date, pack_profile_json,
    logo_image_url, symbol_image_url, pack_preview_image_url, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(set_code) DO UPDATE SET
    name = excluded.name,
    release_date = excluded.release_date,
    pack_profile_json = excluded.pack_profile_json,
    logo_image_url = excluded.logo_image_url,
    symbol_image_url = excluded.symbol_image_url,
    pack_preview_image_url = excluded.pack_preview_image_url,
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
const insertPackProfileVersionStmt = db.prepare(`
  INSERT INTO tcg_pack_profile_versions (product_code, version, set_code, profile_json, is_active, created_at, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const getActivePackProfileVersionStmt = db.prepare(`
  SELECT *
  FROM tcg_pack_profile_versions
  WHERE product_code = ? AND is_active = 1
  ORDER BY version DESC
  LIMIT 1
`);
const deactivatePackProfileVersionsStmt = db.prepare(`
  UPDATE tcg_pack_profile_versions
  SET is_active = 0
  WHERE product_code = ?
`);
const listPackProfileVersionsStmt = db.prepare(`
  SELECT *
  FROM tcg_pack_profile_versions
  WHERE product_code = ?
  ORDER BY version DESC
  LIMIT ?
`);

const getSetStmt = db.prepare('SELECT set_code, name, release_date, pack_profile_json, logo_image_url, symbol_image_url, pack_preview_image_url, updated_at FROM tcg_sets WHERE set_code = ?');
const getCardsBySetStmt = db.prepare('SELECT * FROM tcg_cards WHERE set_code = ?');
const listCachedSetCodesStmt = db.prepare(`
  SELECT set_code, COUNT(*) AS card_count
  FROM tcg_cards
  GROUP BY set_code
  HAVING COUNT(*) >= ?
  ORDER BY card_count DESC, set_code ASC
  LIMIT ?
`);
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
  INSERT INTO tcg_open_events (
    open_id, user_id, guild_id, set_code, product_code, result_json,
    profile_version, drop_audit_json, created_at, idempotency_key
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOpenByIdempotencyStmt = db.prepare('SELECT * FROM tcg_open_events WHERE idempotency_key = ?');
const insertDropAuditStmt = db.prepare(`
  INSERT INTO tcg_drop_audit (open_id, user_id, product_code, profile_version, audit_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getPityStateStmt = db.prepare(`
  SELECT *
  FROM tcg_pity_state
  WHERE user_id = ? AND product_code = ? AND pity_key = ?
`);
const upsertPityStateStmt = db.prepare(`
  INSERT INTO tcg_pity_state (user_id, product_code, pity_key, open_count_since_hit, last_hit_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, product_code, pity_key) DO UPDATE SET
    open_count_since_hit = excluded.open_count_since_hit,
    last_hit_at = excluded.last_hit_at,
    updated_at = excluded.updated_at
`);
const insertClaimablePackStmt = db.prepare(`
  INSERT INTO tcg_claimable_packs (
    pack_id, owner_user_id, granted_by_user_id, set_code, product_code, status,
    grant_source, grant_meta_json, granted_at, claimed_at, opened_at, open_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listClaimablePacksStmt = db.prepare(`
  SELECT *
  FROM tcg_claimable_packs
  WHERE owner_user_id = ? AND status = 'claimable'
  ORDER BY granted_at DESC
  LIMIT ?
`);
const listUnopenedPacksStmt = db.prepare(`
  SELECT *
  FROM tcg_claimable_packs
  WHERE owner_user_id = ? AND status = 'unopened'
  ORDER BY granted_at DESC
  LIMIT ?
`);
const getClaimablePackStmt = db.prepare(`
  SELECT *
  FROM tcg_claimable_packs
  WHERE pack_id = ? AND owner_user_id = ?
`);
const markClaimablePackClaimedStmt = db.prepare(`
  UPDATE tcg_claimable_packs
  SET status = 'unopened', claimed_at = ?
  WHERE pack_id = ? AND owner_user_id = ? AND status = 'claimable'
`);
const markUnopenedPackOpenedStmt = db.prepare(`
  UPDATE tcg_claimable_packs
  SET status = 'opened', opened_at = ?, open_id = ?
  WHERE pack_id = ? AND owner_user_id = ? AND status IN ('unopened', 'opening')
`);
const markUnopenedPackOpeningStmt = db.prepare(`
  UPDATE tcg_claimable_packs
  SET status = 'opening'
  WHERE pack_id = ? AND owner_user_id = ? AND status = 'unopened'
`);
const countUnopenedPacksStmt = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM tcg_claimable_packs
  WHERE owner_user_id = ? AND status = 'unopened'
`);
const getUserSettingsStmt = db.prepare('SELECT * FROM tcg_user_settings WHERE user_id = ?');
const upsertUserSettingsStmt = db.prepare(`
  INSERT INTO tcg_user_settings (user_id, auto_claim_enabled, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    auto_claim_enabled = excluded.auto_claim_enabled,
    updated_at = excluded.updated_at
`);
const listAutoClaimEnabledUsersStmt = db.prepare(`
  SELECT user_id
  FROM tcg_user_settings
  WHERE auto_claim_enabled = 1
  ORDER BY updated_at ASC
  LIMIT ?
`);
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
const listExpiredPendingTradesStmt = db.prepare(`
  SELECT trade_id
  FROM tcg_trades
  WHERE status = 'pending' AND expires_at < ?
  ORDER BY expires_at ASC
  LIMIT ?
`);
const listAdminEventsStmt = db.prepare('SELECT * FROM tcg_admin_events ORDER BY created_at DESC LIMIT ?');
const insertAdminEventStmt = db.prepare(`
  INSERT INTO tcg_admin_events (event_id, admin_user_id, action, payload_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const insertLiveEventStmt = db.prepare(`
  INSERT INTO tcg_live_events (
    event_id, name, effect_type, effect_value, set_scope, status,
    start_at, end_at, created_by_user_id, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getLiveEventByIdStmt = db.prepare('SELECT * FROM tcg_live_events WHERE event_id = ?');
const listLiveEventsByStatusStmt = db.prepare(`
  SELECT *
  FROM tcg_live_events
  WHERE (? = 'all' OR status = ?)
  ORDER BY
    CASE status
      WHEN 'active' THEN 0
      WHEN 'scheduled' THEN 1
      WHEN 'disabled' THEN 2
      WHEN 'expired' THEN 3
      ELSE 4
    END,
    start_at DESC,
    updated_at DESC
  LIMIT ?
`);
const listActiveLiveEventsStmt = db.prepare(`
  SELECT *
  FROM tcg_live_events
  WHERE status = 'active'
    AND start_at <= ?
    AND end_at > ?
  ORDER BY updated_at DESC, start_at DESC
`);
const activateDueEventsStmt = db.prepare(`
  UPDATE tcg_live_events
  SET status = 'active', updated_at = ?
  WHERE status = 'scheduled'
    AND start_at <= ?
    AND end_at > ?
`);
const expireEndedEventsStmt = db.prepare(`
  UPDATE tcg_live_events
  SET status = 'expired', updated_at = ?
  WHERE status = 'active'
    AND end_at <= ?
`);
const setLiveEventStatusStmt = db.prepare(`
  UPDATE tcg_live_events
  SET status = ?, updated_at = ?
  WHERE event_id = ?
`);
const forceStartLiveEventNowStmt = db.prepare(`
  UPDATE tcg_live_events
  SET status = 'active',
      start_at = ?,
      updated_at = ?
  WHERE event_id = ?
`);
const deleteLiveEventStmt = db.prepare('DELETE FROM tcg_live_events WHERE event_id = ?');
const autocompleteLiveEventsStmt = db.prepare(`
  SELECT event_id, name, effect_type, status, set_scope
  FROM tcg_live_events
  WHERE (? = '' OR event_id LIKE ? OR name LIKE ? OR effect_type LIKE ? OR status LIKE ?)
  ORDER BY updated_at DESC
  LIMIT ?
`);
const upsertMarketCatalogStmt = db.prepare(`
  INSERT INTO tcg_market_catalog (card_id, buy_price_credits, sell_price_credits, price_source, is_enabled, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(card_id) DO UPDATE SET
    buy_price_credits = excluded.buy_price_credits,
    sell_price_credits = excluded.sell_price_credits,
    price_source = excluded.price_source,
    is_enabled = excluded.is_enabled,
    updated_at = excluded.updated_at
`);
const getMarketCatalogByCardStmt = db.prepare(`
  SELECT mc.*, c.name, c.set_code, c.rarity, c.rarity_tier, c.image_small, c.image_large
  FROM tcg_market_catalog mc
  JOIN tcg_cards c ON c.card_id = mc.card_id
  WHERE mc.card_id = ? AND mc.is_enabled = 1
`);
const browseMarketCatalogStmt = db.prepare(`
  SELECT mc.card_id, mc.buy_price_credits, mc.sell_price_credits, mc.price_source, mc.updated_at,
         c.name, c.set_code, c.rarity, c.rarity_tier, c.image_small, c.image_large
  FROM tcg_market_catalog mc
  JOIN tcg_cards c ON c.card_id = mc.card_id
  WHERE mc.is_enabled = 1
    AND (? = '' OR c.set_code = ?)
    AND (? = '' OR c.name LIKE ?)
  ORDER BY mc.buy_price_credits DESC, c.name ASC
  LIMIT ? OFFSET ?
`);
const countMarketCatalogStmt = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM tcg_market_catalog mc
  JOIN tcg_cards c ON c.card_id = mc.card_id
  WHERE mc.is_enabled = 1
    AND (? = '' OR c.set_code = ?)
    AND (? = '' OR c.name LIKE ?)
`);
const insertMarketOrderStmt = db.prepare(`
  INSERT INTO tcg_market_orders (
    order_id, user_id, side, card_id, instance_id, qty, unit_price_credits, total_credits, status, created_at, settled_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOwnedInstancesByCardStmt = db.prepare(`
  SELECT instance_id, minted_at
  FROM tcg_card_instances
  WHERE owner_user_id = ? AND card_id = ? AND state = 'owned'
  ORDER BY minted_at DESC
`);
const getUserRarestOwnedCardStmt = db.prepare(`
  SELECT
    i.instance_id,
    i.owner_user_id,
    i.minted_at,
    i.state,
    c.card_id,
    c.name,
    c.rarity,
    c.rarity_tier,
    c.set_code,
    c.image_small,
    c.image_large,
    c.market_price_usd
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
  ORDER BY
    CASE WHEN c.market_price_usd IS NULL THEN 1 ELSE 0 END ASC,
    c.market_price_usd DESC,
    c.rarity_tier DESC,
    i.minted_at DESC
  LIMIT 1
`);
const updateInstanceStateForMarketSellStmt = db.prepare(`
  UPDATE tcg_card_instances
  SET state = 'market_sold', lock_trade_id = ''
  WHERE instance_id = ? AND owner_user_id = ? AND state = 'owned'
`);
const updateInstanceStateForTradeInStmt = db.prepare(`
  UPDATE tcg_card_instances
  SET state = 'trade_in_burned', lock_trade_id = ''
  WHERE instance_id = ? AND owner_user_id = ? AND state = 'owned'
`);
const listOwnedCardCountsStmt = db.prepare(`
  SELECT i.card_id, COUNT(*) AS owned_count, c.name, c.rarity_tier
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ? AND i.state = 'owned'
  GROUP BY i.card_id
  HAVING COUNT(*) > ?
  ORDER BY COUNT(*) DESC, c.name ASC
  LIMIT ?
`);
const autocompleteOwnedCardsStmt = db.prepare(`
  SELECT c.card_id, c.name, c.set_code, COUNT(*) AS owned_count
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND (? = '' OR c.name LIKE ? OR c.set_code LIKE ? OR c.card_id LIKE ?)
  GROUP BY c.card_id, c.name, c.set_code
  ORDER BY owned_count DESC, c.name ASC
  LIMIT ?
`);
const exactOwnedCardNameMatchesStmt = db.prepare(`
  SELECT c.card_id, c.name, c.set_code, COUNT(*) AS owned_count
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND LOWER(c.name) = LOWER(?)
  GROUP BY c.card_id, c.name, c.set_code
  ORDER BY owned_count DESC, c.name ASC
  LIMIT ?
`);
const fuzzyOwnedCardNameMatchesStmt = db.prepare(`
  SELECT c.card_id, c.name, c.set_code, COUNT(*) AS owned_count
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND c.name LIKE ?
  GROUP BY c.card_id, c.name, c.set_code
  ORDER BY owned_count DESC, c.name ASC
  LIMIT ?
`);
const upsertInventoryStatStmt = db.prepare(`
  INSERT INTO tcg_inventory_stats (user_id, card_id, owned_count, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, card_id) DO UPDATE SET
    owned_count = excluded.owned_count,
    updated_at = excluded.updated_at
`);
const autocompleteOwnedInstancesStmt = db.prepare(`
  SELECT i.instance_id, c.name, c.set_code, c.rarity
  FROM tcg_card_instances i
  JOIN tcg_cards c ON c.card_id = i.card_id
  WHERE i.owner_user_id = ?
    AND i.state = 'owned'
    AND (? = '' OR c.name LIKE ? OR c.set_code LIKE ? OR i.instance_id LIKE ?)
  ORDER BY i.minted_at DESC
  LIMIT ?
`);
const autocompleteUnopenedPacksStmt = db.prepare(`
  SELECT pack_id, set_code, grant_source
  FROM tcg_claimable_packs
  WHERE owner_user_id = ?
    AND status = 'unopened'
    AND (? = '' OR pack_id LIKE ? OR set_code LIKE ? OR grant_source LIKE ?)
  ORDER BY granted_at DESC
  LIMIT ?
`);
const autocompleteUserTradesStmt = db.prepare(`
  SELECT trade_id, status, offered_by_user_id, offered_to_user_id
  FROM tcg_trades
  WHERE (offered_by_user_id = ? OR offered_to_user_id = ?)
    AND (? = '' OR trade_id LIKE ? OR status LIKE ?)
  ORDER BY created_at DESC
  LIMIT ?
`);
const autocompleteTradesByStatusStmt = db.prepare(`
  SELECT trade_id, status, offered_by_user_id, offered_to_user_id
  FROM tcg_trades
  WHERE status = ?
    AND (? = '' OR trade_id LIKE ?)
  ORDER BY created_at DESC
  LIMIT ?
`);
const autocompleteSetsStmt = db.prepare(`
  SELECT set_code, name
  FROM tcg_sets
  WHERE (? = '' OR set_code LIKE ? OR name LIKE ?)
  ORDER BY
    CASE WHEN set_code = ? THEN 0 ELSE 1 END,
    CASE WHEN name = ? THEN 0 ELSE 1 END,
    release_date DESC,
    set_code ASC
  LIMIT ?
`);
const setCompletionRowsStmt = db.prepare(`
  SELECT
    c.card_id,
    c.name,
    c.rarity,
    c.rarity_tier,
    c.image_small,
    c.image_large,
    COUNT(i.instance_id) AS owned_count
  FROM tcg_cards c
  LEFT JOIN tcg_card_instances i
    ON i.card_id = c.card_id
   AND i.owner_user_id = ?
   AND i.state = 'owned'
  WHERE c.set_code = ?
  GROUP BY c.card_id, c.name, c.rarity, c.rarity_tier
  ORDER BY c.card_id ASC
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

function getUserSettingsInternal(userId) {
  const row = getUserSettingsStmt.get(userId);
  if (row) return row;
  const created = {
    user_id: userId,
    auto_claim_enabled: 0,
    updated_at: now(),
  };
  upsertUserSettingsStmt.run(created.user_id, created.auto_claim_enabled, created.updated_at);
  return created;
}

export function getTcgUserSettings(userId) {
  return getUserSettingsInternal(userId);
}

export function setAutoClaimEnabled(userId, enabled) {
  const current = getUserSettingsInternal(userId);
  const next = enabled ? 1 : 0;
  upsertUserSettingsStmt.run(current.user_id, next, now());
  return getUserSettingsInternal(userId);
}

export function getTcgSetting(key, fallback = '') {
  const row = getSettingStmt.get(key);
  return row?.value ?? fallback;
}

export function setTcgSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

function isTcgEventsEnabled() {
  const raw = String(process.env.TCG_EVENTS_ENABLED || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

function normalizeEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    set_scope: String(row.set_scope || '').trim().toLowerCase(),
  };
}

function parseEventMultiplier(raw, fallback = 1) {
  const parsed = Number.parseFloat(String(raw || ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseEventBonusPackCount(raw) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.max(0, Math.min(3, parsed));
}

function resolveScopedEvents(events = [], setCode = '') {
  const scoped = [];
  const global = [];
  const safeSetCode = String(setCode || '').trim().toLowerCase();
  for (const row of events) {
    const scope = String(row.set_scope || '').trim().toLowerCase();
    if (scope && safeSetCode && scope === safeSetCode) scoped.push(row);
    else if (!scope) global.push(row);
  }
  const pick = (effectType) =>
    scoped.find((row) => row.effect_type === effectType) ||
    global.find((row) => row.effect_type === effectType) ||
    null;
  return {
    bonusPack: pick('bonus_pack'),
    dropBoost: pick('drop_boost'),
    creditBoost: pick('credit_boost'),
  };
}

export function getPityState(userId, productCode, pityKey = 'tier5_plus') {
  const row = getPityStateStmt.get(userId, productCode, pityKey);
  if (row) return row;
  return {
    user_id: userId,
    product_code: productCode,
    pity_key: pityKey,
    open_count_since_hit: 0,
    last_hit_at: 0,
    updated_at: 0,
  };
}

function upsertPityState(userId, productCode, pityKey, countSinceHit, lastHitAt = 0) {
  upsertPityStateStmt.run(
    userId,
    productCode,
    pityKey,
    Math.max(0, Number(countSinceHit || 0)),
    Math.max(0, Number(lastHitAt || 0)),
    now()
  );
}

export function ensureDefaultTcgSettings() {
  if (!getSettingStmt.get('credit_multiplier')) setSettingStmt.run('credit_multiplier', '1');
  if (!getSettingStmt.get('drop_rate_event_multiplier')) setSettingStmt.run('drop_rate_event_multiplier', '1');
  if (!getSettingStmt.get('trade_locked')) setSettingStmt.run('trade_locked', '0');
  if (!getSettingStmt.get('pity_enabled')) setSettingStmt.run('pity_enabled', '1');
  if (!getSettingStmt.get('pity_threshold_tier5')) setSettingStmt.run('pity_threshold_tier5', '30');
  if (!getSettingStmt.get('guarantee_min_tier')) setSettingStmt.run('guarantee_min_tier', '3');
}

ensureDefaultTcgSettings();
// Legacy rows from the previous model used 'unopened' for admin grants.
db.prepare(`
  UPDATE tcg_claimable_packs
  SET status = 'claimable'
  WHERE status = 'unopened'
    AND claimed_at = 0
    AND opened_at = 0
    AND open_id = ''
    AND grant_source = 'admin_grant'
`).run();

export function upsertSet({
  setCode,
  name = '',
  releaseDate = '',
  packProfileJson = '',
  logoImageUrl = '',
  symbolImageUrl = '',
  packPreviewImageUrl = '',
}) {
  upsertSetStmt.run(
    setCode,
    name,
    releaseDate,
    packProfileJson,
    logoImageUrl || '',
    symbolImageUrl || '',
    packPreviewImageUrl || '',
    now()
  );
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

export const upsertPackProfileVersion = db.transaction(({
  productCode,
  setCode,
  profile,
  createdBy = 'system',
}) => {
  const rows = listPackProfileVersionsStmt.all(productCode, 1);
  const nextVersion = (rows[0]?.version || 0) + 1;
  deactivatePackProfileVersionsStmt.run(productCode);
  insertPackProfileVersionStmt.run(
    productCode,
    nextVersion,
    setCode,
    JSON.stringify(profile || {}),
    1,
    now(),
    createdBy
  );
  if (profile?.slots) {
    upsertPackProfile({ productCode, setCode, slots: profile.slots });
  }
  return getActivePackProfileVersion(productCode);
});

export function getActivePackProfileVersion(productCode) {
  const row = getActivePackProfileVersionStmt.get(productCode);
  if (!row) return null;
  return {
    ...row,
    profile: JSON.parse(row.profile_json || '{}'),
  };
}

export function listPackProfileVersions(productCode, limit = 20) {
  const rows = listPackProfileVersionsStmt.all(productCode, Math.max(1, Math.min(100, Number(limit || 20))));
  return rows.map((row) => ({
    ...row,
    profile: JSON.parse(row.profile_json || '{}'),
  }));
}

export function getSet(setCode) {
  return getSetStmt.get(setCode) || null;
}

export function getCardsBySet(setCode) {
  return getCardsBySetStmt.all(setCode);
}

export function listCachedSetCodes({ minCards = 1, limit = 25 } = {}) {
  const safeMin = Math.max(1, Number(minCards || 1));
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 25)));
  return listCachedSetCodesStmt.all(safeMin, safeLimit).map((row) => row.set_code);
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

function applyOpenRewardsInternal(userId, openRef, setCode = '') {
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

  const baseMultiplier = Number.parseFloat(getTcgSetting('credit_multiplier', '1')) || 1;
  const eventEffects = getEffectiveEventEffects({ setCode });
  const multiplier = Math.max(0, baseMultiplier * Number(eventEffects.creditMultiplier || 1));
  const base = Math.max(0, Math.round(DEFAULT_CREDITS_PER_OPEN * multiplier));
  const streakBonus = Math.max(0, Math.round(DEFAULT_STREAK_BONUS * multiplier * Math.max(0, streakDays - 1)));
  const earned = base + streakBonus;

  const updated = {
    ...wallet,
    credits: wallet.credits + earned,
    opened_count: (wallet.opened_count || 0) + 1,
    last_open_at: now(),
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
  return { wallet: updated, earned, base, streakBonus, multiplier };
}

export function getFreePackAvailability(userId) {
  const wallet = getWalletInternal(userId);
  const nextAt = (wallet.last_free_pack_at || 0) + FREE_PACK_COOLDOWN_MS;
  const availableInMs = Math.max(0, nextAt - now());
  return { available: availableInMs === 0, availableInMs, nextAt };
}

function createPackRecord({
  ownerUserId,
  grantedByUserId,
  setCode,
  productCode,
  status,
  grantSource,
  grantMeta = {},
}) {
  const packId = generateId('pack');
  const grantedAt = now();
  const claimedAt = status === 'unopened' ? grantedAt : 0;
  insertClaimablePackStmt.run(
    packId,
    ownerUserId,
    grantedByUserId,
    setCode,
    productCode || `${setCode}-default`,
    status,
    grantSource || 'admin_grant',
    JSON.stringify(grantMeta || {}),
    grantedAt,
    claimedAt,
    0,
    ''
  );
  return getClaimablePackStmt.get(packId, ownerUserId);
}

export const grantAdminSealedPacks = db.transaction((adminUserId, userId, { setCode, productCode = '', quantity = 1 }) => {
  const safeQuantity = Math.max(1, Math.min(500, Number(quantity || 1)));
  const packs = [];
  for (let i = 0; i < safeQuantity; i += 1) {
    const created = createPackRecord({
      ownerUserId: userId,
      grantedByUserId: adminUserId,
      setCode,
      productCode: productCode || `${setCode}-default`,
      status: 'claimable',
      grantSource: 'admin_grant',
      grantMeta: {},
    });
    packs.push(created);
  }
  insertAdminEventStmt.run(
    generateId('admin'),
    adminUserId,
    'grant_sealed_packs',
    JSON.stringify({ userId, setCode, productCode: productCode || `${setCode}-default`, quantity: safeQuantity }),
    now()
  );
  return packs;
});

export function listClaimablePacks(userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  return listClaimablePacksStmt.all(userId, safeLimit);
}

export function listUnopenedPacks(userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  return listUnopenedPacksStmt.all(userId, safeLimit);
}

export function getClaimablePack(packId, userId) {
  return getClaimablePackStmt.get(packId, userId) || null;
}

export function claimPack(packId, userId) {
  const result = markClaimablePackClaimedStmt.run(now(), packId, userId);
  if (result.changes !== 1) {
    throw new Error('pack is not available to claim');
  }
  return getClaimablePack(packId, userId);
}

export function markClaimablePackOpened(packId, userId, openId) {
  const result = markUnopenedPackOpenedStmt.run(now(), openId || '', packId, userId);
  if (result.changes !== 1) {
    throw new Error('pack is not available to open');
  }
  return getClaimablePack(packId, userId);
}

export const claimCooldownPack = db.transaction((userId, setCode = '', options = {}) => {
  const availability = getFreePackAvailability(userId);
  if (!availability.available) {
    throw new Error('cooldown not ready');
  }

  const wallet = getWalletInternal(userId);
  const next = {
    ...wallet,
    last_free_pack_at: now(),
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

  const safeSetCode = String(setCode || AUTO_CLAIM_DEFAULT_SET).trim().toLowerCase() || AUTO_CLAIM_DEFAULT_SET;
  const grantSource = String(options?.grantSource || 'cooldown_offer');
  const allowBonus = options?.allowBonus !== false;
  const primary = createPackRecord({
    ownerUserId: userId,
    grantedByUserId: 'system',
    setCode: safeSetCode,
    productCode: `${safeSetCode}-default`,
    status: 'unopened',
    grantSource,
    grantMeta: {},
  });
  if (!allowBonus) return primary;

  const effects = getEffectiveEventEffects({ setCode: safeSetCode });
  const bonusCount = Math.max(0, Number(effects.bonusPackCount || 0));
  for (let i = 0; i < bonusCount; i += 1) {
    createPackRecord({
      ownerUserId: userId,
      grantedByUserId: 'system',
      setCode: safeSetCode,
      productCode: `${safeSetCode}-default`,
      status: 'unopened',
      grantSource: 'event_bonus_pack',
      grantMeta: {
        sourceEventId: effects.activeByEffect?.bonusPack?.event_id || '',
      },
    });
  }
  return primary;
});

export function runAutoClaimSweep({ maxPending = 24, limitUsers = 200 } = {}) {
  const safeCap = Math.max(1, Math.min(500, Number(maxPending || 24)));
  const safeLimitUsers = Math.max(1, Math.min(2000, Number(limitUsers || 200)));
  const users = listAutoClaimEnabledUsersStmt.all(safeLimitUsers);
  let claimedCount = 0;

  for (const row of users) {
    const userId = row.user_id;
    const unopenedCount = countUnopenedPacksStmt.get(userId)?.cnt || 0;
    if (unopenedCount >= safeCap) continue;
    const availability = getFreePackAvailability(userId);
    if (!availability.available) continue;
    try {
      claimCooldownPack(userId, AUTO_CLAIM_DEFAULT_SET, {
        allowBonus: false,
        grantSource: 'auto_claim_sweep',
      });
      claimedCount += 1;
    } catch {
      // Skip and continue.
    }
  }

  return claimedCount;
}

function applyPityProgressInternal({ userId, productCode, minted = [], pityKey = 'tier5_plus', pityTriggered = false }) {
  if (getTcgSetting('pity_enabled', '1') !== '1') return getPityState(userId, productCode, pityKey);
  const current = getPityState(userId, productCode, pityKey);
  const highTierPulled = minted.some((card) => Number(card?.rarity_tier || 0) >= 5);
  if (pityTriggered || highTierPulled) {
    upsertPityState(userId, productCode, pityKey, 0, now());
    return getPityState(userId, productCode, pityKey);
  }
  const nextCount = Number(current.open_count_since_hit || 0) + 1;
  upsertPityState(userId, productCode, pityKey, nextCount, Number(current.last_hit_at || 0));
  return getPityState(userId, productCode, pityKey);
}

function mintOpenInternal({
  idempotencyKey,
  userId,
  guildId,
  setCode,
  productCode,
  pulls,
  profileVersion = '',
  dropAudit = {},
  pityTriggered = false,
}) {
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
  for (const card of pulls || []) {
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

  const rewards = applyOpenRewardsInternal(userId, openId, setCode);
  const pity = applyPityProgressInternal({
    userId,
    productCode,
    minted,
    pityTriggered: !!pityTriggered,
  });
  const auditPayload = {
    ...(dropAudit && typeof dropAudit === 'object' ? dropAudit : {}),
    pity_state_after: pity,
    pity_triggered: !!pityTriggered,
  };
  const payload = { minted, rewards, profileVersion: String(profileVersion || ''), dropAudit: auditPayload };
  insertOpenEventStmt.run(
    openId,
    userId,
    guildId || null,
    setCode,
    productCode,
    JSON.stringify(payload),
    String(profileVersion || ''),
    JSON.stringify(auditPayload),
    now(),
    idempotencyKey
  );
  insertDropAuditStmt.run(
    openId,
    userId,
    productCode,
    String(profileVersion || ''),
    JSON.stringify(auditPayload),
    now()
  );

  return { reused: false, openId, result: payload, rewards };
}

export const createOpenWithMint = db.transaction(({
  idempotencyKey,
  userId,
  guildId,
  setCode,
  productCode,
  pulls,
  profileVersion = '',
  dropAudit = {},
  pityTriggered = false,
}) => {
  return mintOpenInternal({
    idempotencyKey,
    userId,
    guildId,
    setCode,
    productCode,
    pulls,
    profileVersion,
    dropAudit,
    pityTriggered,
  });
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

const cancelOrRejectTradeInternal = db.transaction((tradeId, expectedStatus, nextStatus) => {
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

export function cancelTradeByActor(tradeId, actorUserId) {
  const trade = getTradeStmt.get(tradeId);
  if (!trade) throw new Error('trade not found');
  if (trade.offered_by_user_id !== actorUserId) {
    throw new Error('only the offering user can cancel this trade');
  }
  return cancelOrRejectTradeInternal(tradeId, 'pending', 'cancelled');
}

export function rejectTradeByActor(tradeId, actorUserId) {
  const trade = getTradeStmt.get(tradeId);
  if (!trade) throw new Error('trade not found');
  if (trade.offered_to_user_id !== actorUserId) {
    throw new Error('only the target user can reject this trade');
  }
  return cancelOrRejectTradeInternal(tradeId, 'pending', 'rejected');
}

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
  return cancelOrRejectTradeInternal(tradeId, 'pending', 'expired');
}

export function expirePendingTrades(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  const rows = listExpiredPendingTradesStmt.all(now(), safeLimit);
  let expired = 0;
  for (const row of rows) {
    try {
      const result = cancelOrRejectTradeInternal(row.trade_id, 'pending', 'expired');
      if (result?.status === 'expired') expired += 1;
    } catch {
      // Trade may have changed status concurrently; skip.
    }
  }
  return expired;
}

export const openUnopenedPackWithMint = db.transaction(({
  idempotencyKey,
  userId,
  guildId,
  packId,
  pulls,
  profileVersion = '',
  dropAudit = {},
  pityTriggered = false,
}) => {
  if (!idempotencyKey) {
    throw new Error('missing idempotency key');
  }
  const existing = getOpenByIdempotencyStmt.get(idempotencyKey);
  if (existing) {
    return {
      reused: true,
      openId: existing.open_id,
      result: JSON.parse(existing.result_json || '{}'),
      rewards: null,
    };
  }

  const pack = getClaimablePackStmt.get(packId, userId);
  if (!pack) throw new Error('pack not found');
  if (pack.status !== 'unopened') throw new Error('pack is not available to open');

  const locked = markUnopenedPackOpeningStmt.run(packId, userId);
  if (locked.changes !== 1) throw new Error('pack is not available to open');

  const result = mintOpenInternal({
    idempotencyKey,
    userId,
    guildId,
    setCode: pack.set_code,
    productCode: pack.product_code || `${pack.set_code}-default`,
    pulls,
    profileVersion,
    dropAudit,
    pityTriggered,
  });

  const opened = markUnopenedPackOpenedStmt.run(now(), result.openId, packId, userId);
  if (opened.changes !== 1) {
    throw new Error('pack finalization failed');
  }
  return result;
});

export function recomputeInventoryStatsForUser(userId) {
  const rows = db.prepare(`
    SELECT card_id, COUNT(*) AS owned_count
    FROM tcg_card_instances
    WHERE owner_user_id = ? AND state = 'owned'
    GROUP BY card_id
  `).all(userId);
  const ts = now();
  for (const row of rows) {
    upsertInventoryStatStmt.run(userId, row.card_id, row.owned_count, ts);
  }
}

export function getMarketSummary() {
  const catalogCount = db.prepare('SELECT COUNT(*) AS cnt FROM tcg_market_catalog WHERE is_enabled = 1').get()?.cnt || 0;
  const orderCount24h = db.prepare('SELECT COUNT(*) AS cnt FROM tcg_market_orders WHERE created_at >= ?').get(now() - 24 * 60 * 60 * 1000)?.cnt || 0;
  return { catalogCount, orderCount24h };
}

export function getPackQueuesForUser(userId) {
  const claimable = listClaimablePacks(userId, 50);
  const unopened = listUnopenedPacks(userId, 50);
  const previewSetCode = claimable[0]?.set_code || unopened[0]?.set_code || '';
  return {
    claimable,
    unopened,
    cooldown: getFreePackAvailability(userId),
    events: getEffectiveEventEffects({ setCode: previewSetCode }),
  };
}

export function getDuplicateSummaryForUser(userId, keepPerCard = 2) {
  const keep = Math.max(0, Math.min(20, Number(keepPerCard || 2)));
  return listOwnedCardCountsStmt.all(userId, keep, 200);
}

export function getOwnedCardAutocompleteChoices(userId, query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteOwnedCardsStmt.all(userId, text, like, like, like, safeLimit);
  return rows.map((row) => ({
    name: `${row.name} (${row.set_code.toUpperCase()}) x${row.owned_count}`.slice(0, 100),
    value: `card:${row.card_id}`,
  }));
}

export function getOwnedInstanceAutocompleteChoices(userId, query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteOwnedInstancesStmt.all(userId, text, like, like, like, safeLimit);
  return rows.map((row) => ({
    name: `${row.name} (${row.set_code.toUpperCase()}) [${row.rarity || 'Unknown'}]`.slice(0, 100),
    value: row.instance_id,
  }));
}

export function getUnopenedPackAutocompleteChoices(userId, query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim().toLowerCase();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteUnopenedPacksStmt.all(userId, text, like, like, like, safeLimit);
  return rows.map((row) => ({
    name: `${row.set_code.toUpperCase()} • ${row.grant_source || 'unopened'} • ${row.pack_id.slice(0, 18)}`.slice(0, 100),
    value: row.pack_id,
  }));
}

export function getTradeAutocompleteChoicesForUser(userId, query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteUserTradesStmt.all(userId, userId, text, like, like, safeLimit);
  return rows.map((row) => ({
    name: `${row.trade_id} • ${row.status} • ${row.offered_by_user_id.slice(-4)}→${row.offered_to_user_id.slice(-4)}`.slice(0, 100),
    value: row.trade_id,
  }));
}

export function getTradeAutocompleteChoicesByStatus(status, query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteTradesByStatusStmt.all(status, text, like, safeLimit);
  return rows.map((row) => ({
    name: `${row.trade_id} • ${row.status} • ${row.offered_by_user_id.slice(-4)}→${row.offered_to_user_id.slice(-4)}`.slice(0, 100),
    value: row.trade_id,
  }));
}

export function getSetAutocompleteChoices(query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim().toLowerCase();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteSetsStmt.all(text, like, like, text, text, safeLimit);
  return rows.map((row) => ({
    name: `${row.name || row.set_code.toUpperCase()} (${row.set_code.toUpperCase()})`.slice(0, 100),
    value: row.set_code,
  }));
}

export function getSetCompletionForUser(userId, setCode) {
  const safeSetCode = String(setCode || '').trim().toLowerCase();
  if (!safeSetCode) {
    throw new Error('missing set code');
  }
  const set = getSet(safeSetCode);
  const rows = setCompletionRowsStmt.all(userId, safeSetCode);
  const total = rows.length;
  const ownedUnique = rows.filter((row) => Number(row.owned_count || 0) > 0).length;
  const duplicates = rows.filter((row) => Number(row.owned_count || 0) > 1);
  const missing = rows.filter((row) => Number(row.owned_count || 0) === 0);
  return {
    setCode: safeSetCode,
    setName: set?.name || safeSetCode.toUpperCase(),
    total,
    ownedUnique,
    missingCount: missing.length,
    completionPct: total > 0 ? (ownedUnique / total) * 100 : 0,
    rows,
    missing,
    duplicates,
  };
}

function resolveOwnedCardByName(userId, selection) {
  const exactMatches = exactOwnedCardNameMatchesStmt.all(userId, selection, 10);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(`multiple owned cards match "${selection}". Use autocomplete to pick one.`);
  }
  const fuzzyMatches = fuzzyOwnedCardNameMatchesStmt.all(userId, `%${selection}%`, 10);
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1) {
    throw new Error(`multiple owned cards match "${selection}". Use autocomplete to pick one.`);
  }
  throw new Error(`no owned card matches "${selection}"`);
}

export function resolveOwnedInstanceIdsForSelection(userId, selection, quantity = 1) {
  const safeQty = Math.max(1, Math.min(25, Number(quantity || 1)));
  const raw = String(selection || '').trim();
  if (!raw) {
    throw new Error('missing card selection');
  }

  if (raw.startsWith('ci_')) {
    const row = getInstanceByIdStmt.get(raw);
    if (!row) throw new Error('card instance not found');
    if (row.owner_user_id !== userId || row.state !== 'owned') {
      throw new Error('selected instance is not owned or sellable');
    }
    return {
      instanceIds: [row.instance_id],
      cardId: row.card_id,
      cardName: row.name,
      availableCount: 1,
    };
  }

  const cardId = raw.startsWith('card:') ? raw.slice('card:'.length) : raw;
  let matchedCard = null;

  if (cardId) {
    const owned = getOwnedInstancesByCardStmt.all(userId, cardId);
    if (owned.length > 0) {
      const card = getCardById(cardId);
      matchedCard = { card_id: cardId, name: card?.name || cardId, set_code: card?.set_code || '', owned_count: owned.length };
    }
  }

  if (!matchedCard) {
    matchedCard = resolveOwnedCardByName(userId, raw);
  }

  const instances = getOwnedInstancesByCardStmt.all(userId, matchedCard.card_id);
  if (instances.length < safeQty) {
    throw new Error(`you only have ${instances.length} copies of ${matchedCard.name}`);
  }
  return {
    instanceIds: instances.slice(0, safeQty).map((row) => row.instance_id),
    cardId: matchedCard.card_id,
    cardName: matchedCard.name,
    availableCount: instances.length,
  };
}

export function getCardInstance(instanceId) {
  return getInstanceByIdStmt.get(instanceId) || null;
}

export function getCardById(cardId) {
  return db.prepare('SELECT * FROM tcg_cards WHERE card_id = ?').get(cardId) || null;
}

export function getUserRarestCard(userId) {
  return getUserRarestOwnedCardStmt.get(userId) || null;
}

export function getCardValue(card) {
  if (Number.isFinite(Number(card?.market_price_usd))) {
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

function toCredits(usd) {
  return Math.max(1, Math.round(Number(usd || 0) * MARKET_CREDITS_PER_USD));
}

function buildFormulaMarketPrices(card) {
  const value = getCardValue(card);
  const baseCredits = toCredits(value.valueUsd);
  return {
    buyPriceCredits: Math.max(MARKET_BUY_FLOOR, Math.round(baseCredits * MARKET_BUY_MULT)),
    sellPriceCredits: Math.max(MARKET_SELL_FLOOR, Math.round(baseCredits * MARKET_SELL_MULT)),
    priceSource: value.source,
  };
}

export function upsertMarketCatalogForCard(cardId) {
  const card = getCardById(cardId);
  if (!card) throw new Error('unknown card');
  const prices = buildFormulaMarketPrices(card);
  upsertMarketCatalogStmt.run(
    cardId,
    prices.buyPriceCredits,
    prices.sellPriceCredits,
    prices.priceSource,
    1,
    now()
  );
  return getMarketCatalogByCardStmt.get(cardId) || null;
}

export function getMarketCard(cardId) {
  let row = getMarketCatalogByCardStmt.get(cardId);
  if (row) return row;
  row = upsertMarketCatalogForCard(cardId);
  return row;
}

export function browseMarketCatalog({ page = 1, pageSize = 12, setCode = '', nameLike = '' }) {
  const safePage = Math.max(1, Number(page || 1));
  const safeSize = Math.max(1, Math.min(50, Number(pageSize || 12)));
  const offset = (safePage - 1) * safeSize;
  const like = nameLike ? `%${nameLike}%` : '';
  const rows = browseMarketCatalogStmt.all(setCode || '', setCode || '', like, like, safeSize, offset);
  const total = countMarketCatalogStmt.get(setCode || '', setCode || '', like, like)?.cnt || 0;
  return {
    rows,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export function getBuyQuote(cardId, quantity = 1) {
  const qty = Math.max(1, Math.min(100, Number(quantity || 1)));
  const card = getMarketCard(cardId);
  if (!card) throw new Error('card not listed in market');
  return {
    cardId: card.card_id,
    cardName: card.name,
    unitPriceCredits: card.buy_price_credits,
    quantity: qty,
    totalCredits: card.buy_price_credits * qty,
  };
}

export function getSellQuoteForInstances(userId, instanceIds = []) {
  const deduped = [...new Set(Array.isArray(instanceIds) ? instanceIds.filter(Boolean) : [])];
  if (!deduped.length) throw new Error('no instance ids provided');
  const items = [];
  let total = 0;
  for (const instanceId of deduped) {
    const row = getInstanceByIdStmt.get(instanceId);
    if (!row) throw new Error(`missing card instance ${instanceId}`);
    if (row.owner_user_id !== userId || row.state !== 'owned') {
      throw new Error(`instance not sellable: ${instanceId}`);
    }
    const market = getMarketCard(row.card_id);
    if (!market) throw new Error(`card not market-listed: ${row.card_id}`);
    total += market.sell_price_credits;
    items.push({
      instanceId,
      cardId: row.card_id,
      cardName: row.name,
      unitPriceCredits: market.sell_price_credits,
    });
  }
  return {
    items,
    quantity: items.length,
    totalCredits: total,
  };
}

export const executeMarketBuy = db.transaction(({ userId, cardId, quantity = 1, idempotencyKey = '' }) => {
  const quote = getBuyQuote(cardId, quantity);
  const orderId = generateId('mkt');
  addCreditsInternal(userId, -quote.totalCredits, 'market_buy', orderId);

  const mintedAt = now();
  const batchId = generateId('mint');
  for (let i = 0; i < quote.quantity; i += 1) {
    insertInstanceStmt.run(generateId('ci'), quote.cardId, userId, mintedAt, 'market_buy', batchId);
  }

  insertMarketOrderStmt.run(
    orderId,
    userId,
    'buy',
    quote.cardId,
    '',
    quote.quantity,
    quote.unitPriceCredits,
    quote.totalCredits,
    'settled',
    mintedAt,
    mintedAt
  );

  return { orderId, ...quote, idempotencyKey };
});

export const executeMarketSellInstances = db.transaction(({ userId, instanceIds = [] }) => {
  const quote = getSellQuoteForInstances(userId, instanceIds);
  const settledAt = now();
  for (const item of quote.items) {
    const updated = updateInstanceStateForMarketSellStmt.run(item.instanceId, userId);
    if (updated.changes !== 1) {
      throw new Error(`failed to sell ${item.instanceId}`);
    }
    const orderId = generateId('mkt');
    insertMarketOrderStmt.run(
      orderId,
      userId,
      'sell',
      item.cardId,
      item.instanceId,
      1,
      item.unitPriceCredits,
      item.unitPriceCredits,
      'settled',
      settledAt,
      settledAt
    );
  }
  addCreditsInternal(userId, quote.totalCredits, 'market_sell', `sell_batch_${settledAt}`);
  return quote;
});

export const executeMarketSellDuplicates = db.transaction(({
  userId,
  keepPerCard = 2,
  maxTier = 3,
  maxUnitValue = Number.MAX_SAFE_INTEGER,
  limitCards = 200,
}) => {
  const keep = Math.max(0, Math.min(20, Number(keepPerCard || 0)));
  const tierCap = Math.max(1, Math.min(6, Number(maxTier || 3)));
  const valueCap = Math.max(0, Number(maxUnitValue || 0));
  const rows = listOwnedCardCountsStmt.all(userId, keep, Math.max(1, Math.min(1000, Number(limitCards || 200))));
  const selectedInstanceIds = [];

  for (const row of rows) {
    if (Number(row.rarity_tier || 1) > tierCap) continue;
    const market = getMarketCard(row.card_id);
    if (!market) continue;
    if (market.sell_price_credits > valueCap) continue;
    const owned = getOwnedInstancesByCardStmt.all(userId, row.card_id);
    const sellable = owned.slice(keep);
    for (const inst of sellable) {
      selectedInstanceIds.push(inst.instance_id);
    }
  }

  if (!selectedInstanceIds.length) {
    return { items: [], quantity: 0, totalCredits: 0 };
  }
  return executeMarketSellInstances({ userId, instanceIds: selectedInstanceIds });
});

function getTradeInCreditsForTier(tier) {
  const safeTier = Math.max(1, Math.min(6, Number(tier || 1)));
  return Number(TRADE_IN_CREDITS_BY_RARITY_TIER[safeTier] || TRADE_IN_CREDITS_BY_RARITY_TIER[1] || 1);
}

export const executeTradeInDuplicates = db.transaction((userId) => {
  const rows = listOwnedCardCountsStmt.all(userId, 1, 500);
  if (!rows.length) {
    const wallet = getWalletInternal(userId);
    return {
      burnedCount: 0,
      totalCredits: 0,
      walletCredits: wallet.credits,
      breakdown: [],
    };
  }

  const breakdownMap = new Map();
  let burnedCount = 0;
  let totalCredits = 0;

  for (const row of rows) {
    const ownedCount = Number(row.owned_count || 0);
    if (ownedCount <= 1) continue;
    const burnCount = ownedCount - 1;
    const creditsPerCard = getTradeInCreditsForTier(row.rarity_tier);
    const ownedInstances = getOwnedInstancesByCardStmt.all(userId, row.card_id);
    const burnInstances = ownedInstances.slice(1);

    for (const inst of burnInstances) {
      const updated = updateInstanceStateForTradeInStmt.run(inst.instance_id, userId);
      if (updated.changes !== 1) {
        throw new Error(`failed to trade-in ${inst.instance_id}`);
      }
    }

    const earned = burnCount * creditsPerCard;
    burnedCount += burnCount;
    totalCredits += earned;

    const key = String(Math.max(1, Math.min(6, Number(row.rarity_tier || 1))));
    const prev = breakdownMap.get(key) || { tier: Number(key), burned: 0, credits: 0 };
    prev.burned += burnCount;
    prev.credits += earned;
    breakdownMap.set(key, prev);
  }

  const updatedWallet = totalCredits > 0
    ? addCreditsInternal(userId, totalCredits, 'trade_in_duplicates', `trade_in_${now()}`)
    : getWalletInternal(userId);
  const breakdown = [...breakdownMap.values()].sort((a, b) => b.tier - a.tier);
  return {
    burnedCount,
    totalCredits,
    walletCredits: updatedWallet.credits,
    breakdown,
  };
});

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

function validateLiveEventInput({ name, effectType, effectValue, setScope = '', startAt, endAt }) {
  const safeName = String(name || '').trim();
  const safeType = String(effectType || '').trim().toLowerCase();
  const safeValue = String(effectValue || '').trim();
  const safeScope = String(setScope || '').trim().toLowerCase();
  const safeStartAt = Number(startAt || 0);
  const safeEndAt = Number(endAt || 0);

  if (!safeName) throw new Error('event name is required');
  if (!['bonus_pack', 'drop_boost', 'credit_boost'].includes(safeType)) {
    throw new Error('unknown effect type');
  }
  if (!Number.isFinite(safeStartAt) || !Number.isFinite(safeEndAt) || safeStartAt <= 0 || safeEndAt <= 0) {
    throw new Error('invalid start/end time');
  }
  if (safeStartAt >= safeEndAt) throw new Error('start time must be before end time');

  const maxDurationMs = 14 * 24 * 60 * 60 * 1000;
  if (safeEndAt - safeStartAt > maxDurationMs) {
    throw new Error('event duration too long');
  }

  if (safeType === 'bonus_pack') {
    const n = parseEventBonusPackCount(safeValue);
    if (n < 1 || n > 3) throw new Error('bonus_pack value must be an integer between 1 and 3');
  } else {
    const n = parseEventMultiplier(safeValue, 0);
    if (n < 1 || n > 3) throw new Error(`${safeType} value must be between 1.0 and 3.0`);
  }

  if (safeScope && !getSet(safeScope)) {
    throw new Error(`unknown set scope: ${safeScope}`);
  }

  return {
    name: safeName,
    effectType: safeType,
    effectValue: safeValue,
    setScope: safeScope,
    startAt: safeStartAt,
    endAt: safeEndAt,
  };
}

export const createLiveEvent = db.transaction((adminUserId, payload) => {
  if (!isTcgEventsEnabled()) {
    throw new Error('tcg events are disabled (set TCG_EVENTS_ENABLED=1)');
  }
  const validated = validateLiveEventInput(payload || {});
  const eventId = generateId('event');
  const currentTs = now();
  const initialStatus = payload?.enabled === false
    ? 'disabled'
    : (validated.startAt <= currentTs && validated.endAt > currentTs ? 'active' : 'scheduled');

  // One active event per effect + scope.
  if (initialStatus === 'active') {
    const active = listActiveLiveEventsStmt.all(currentTs, currentTs).map(normalizeEventRow);
    const conflict = active.find((row) =>
      row.effect_type === validated.effectType && String(row.set_scope || '') === validated.setScope
    );
    if (conflict) {
      throw new Error(`active ${validated.effectType} event already exists for scope "${validated.setScope || 'global'}"`);
    }
  }

  insertLiveEventStmt.run(
    eventId,
    validated.name,
    validated.effectType,
    validated.effectValue,
    validated.setScope,
    initialStatus,
    validated.startAt,
    validated.endAt,
    adminUserId,
    currentTs,
    currentTs
  );
  insertAdminEventStmt.run(
    generateId('admin'),
    adminUserId,
    'live_event_create',
    JSON.stringify({ eventId, ...validated, status: initialStatus }),
    currentTs
  );
  return normalizeEventRow(getLiveEventByIdStmt.get(eventId));
});

export function getLiveEvent(eventId) {
  return normalizeEventRow(getLiveEventByIdStmt.get(eventId));
}

export function listLiveEvents({ status = 'all', limit = 20 } = {}) {
  const safeStatus = ['all', 'scheduled', 'active', 'expired', 'disabled'].includes(String(status || '').toLowerCase())
    ? String(status || '').toLowerCase()
    : 'all';
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 20)));
  return listLiveEventsByStatusStmt.all(safeStatus, safeStatus, safeLimit).map(normalizeEventRow);
}

export function listActiveLiveEvents({ setCode = '' } = {}) {
  if (!isTcgEventsEnabled()) return [];
  const currentTs = now();
  const rows = listActiveLiveEventsStmt.all(currentTs, currentTs).map(normalizeEventRow);
  if (!setCode) return rows;
  const safeSetCode = String(setCode || '').trim().toLowerCase();
  return rows.filter((row) => !row.set_scope || row.set_scope === safeSetCode);
}

export function getEffectiveEventEffects({ setCode = '' } = {}) {
  const neutral = {
    enabled: isTcgEventsEnabled(),
    bonusPackCount: 0,
    dropBoostMultiplier: 1,
    creditMultiplier: 1,
    activeEvents: [],
    activeByEffect: {
      bonusPack: null,
      dropBoost: null,
      creditBoost: null,
    },
  };
  if (!neutral.enabled) return neutral;
  const rows = listActiveLiveEvents({ setCode });
  const resolved = resolveScopedEvents(rows, setCode);
  neutral.activeEvents = rows;
  neutral.activeByEffect = resolved;
  if (resolved.bonusPack) neutral.bonusPackCount = parseEventBonusPackCount(resolved.bonusPack.effect_value);
  if (resolved.dropBoost) neutral.dropBoostMultiplier = parseEventMultiplier(resolved.dropBoost.effect_value, 1);
  if (resolved.creditBoost) neutral.creditMultiplier = parseEventMultiplier(resolved.creditBoost.effect_value, 1);
  return neutral;
}

export const setLiveEventStatus = db.transaction((adminUserId, eventId, nextStatus) => {
  if (!isTcgEventsEnabled()) {
    throw new Error('tcg events are disabled (set TCG_EVENTS_ENABLED=1)');
  }
  const safeStatus = String(nextStatus || '').toLowerCase();
  if (!['active', 'scheduled', 'expired', 'disabled'].includes(safeStatus)) {
    throw new Error('invalid live event status');
  }
  const current = getLiveEventByIdStmt.get(eventId);
  if (!current) throw new Error('event not found');
  const currentTs = now();

  if (safeStatus === 'active') {
    if (!(current.start_at <= currentTs && current.end_at > currentTs)) {
      throw new Error('event window is not currently active');
    }
    const active = listActiveLiveEventsStmt.all(currentTs, currentTs).map(normalizeEventRow);
    const conflict = active.find((row) =>
      row.event_id !== current.event_id &&
      row.effect_type === current.effect_type &&
      String(row.set_scope || '') === String(current.set_scope || '')
    );
    if (conflict) {
      throw new Error(`conflict with active event ${conflict.event_id} for same effect/scope`);
    }
  }

  const updated = setLiveEventStatusStmt.run(safeStatus, currentTs, eventId);
  if (updated.changes !== 1) throw new Error('event status update failed');
  insertAdminEventStmt.run(
    generateId('admin'),
    adminUserId,
    'live_event_status',
    JSON.stringify({ eventId, from: current.status, to: safeStatus }),
    currentTs
  );
  return normalizeEventRow(getLiveEventByIdStmt.get(eventId));
});

export const deleteLiveEvent = db.transaction((adminUserId, eventId) => {
  const current = getLiveEventByIdStmt.get(eventId);
  if (!current) throw new Error('event not found');
  const removed = deleteLiveEventStmt.run(eventId);
  if (removed.changes !== 1) throw new Error('event delete failed');
  insertAdminEventStmt.run(
    generateId('admin'),
    adminUserId,
    'live_event_delete',
    JSON.stringify({ eventId, name: current.name }),
    now()
  );
  return true;
});

export const setLiveEventNow = db.transaction((adminUserId, eventId, mode) => {
  const current = getLiveEventByIdStmt.get(eventId);
  if (!current) throw new Error('event not found');
  const currentTs = now();
  const safeMode = String(mode || '').toLowerCase();
  if (safeMode === 'start_now') {
    if (current.end_at <= currentTs) {
      throw new Error('event already ended');
    }
    const active = listActiveLiveEventsStmt.all(currentTs, currentTs).map(normalizeEventRow);
    const conflict = active.find((row) =>
      row.event_id !== current.event_id &&
      row.effect_type === current.effect_type &&
      String(row.set_scope || '') === String(current.set_scope || '')
    );
    if (conflict) {
      throw new Error(`conflict with active event ${conflict.event_id} for same effect/scope`);
    }
    const result = forceStartLiveEventNowStmt.run(currentTs, currentTs, eventId);
    if (result.changes !== 1) throw new Error('failed to start event now');
    insertAdminEventStmt.run(
      generateId('admin'),
      adminUserId,
      'live_event_start_now',
      JSON.stringify({ eventId }),
      currentTs
    );
    return normalizeEventRow(getLiveEventByIdStmt.get(eventId));
  }
  if (safeMode === 'stop_now') {
    return setLiveEventStatus(adminUserId, eventId, 'disabled');
  }
  throw new Error('unknown mode');
});

export const activateDueLiveEvents = db.transaction((adminUserId = 'system') => {
  if (!isTcgEventsEnabled()) return 0;
  const currentTs = now();
  const due = listLiveEventsByStatusStmt.all('scheduled', 'scheduled', 500).map(normalizeEventRow)
    .filter((row) => row.start_at <= currentTs && row.end_at > currentTs);
  let activated = 0;
  for (const row of due) {
    const conflict = listActiveLiveEventsStmt.all(currentTs, currentTs).map(normalizeEventRow).find((active) =>
      active.event_id !== row.event_id &&
      active.effect_type === row.effect_type &&
      String(active.set_scope || '') === String(row.set_scope || '')
    );
    if (conflict) continue;
    const result = setLiveEventStatusStmt.run('active', currentTs, row.event_id);
    if (result.changes === 1) {
      activated += 1;
      insertAdminEventStmt.run(
        generateId('admin'),
        adminUserId,
        'live_event_auto_activate',
        JSON.stringify({ eventId: row.event_id }),
        currentTs
      );
    }
  }
  return activated;
});

export const expireEndedLiveEvents = db.transaction((adminUserId = 'system') => {
  if (!isTcgEventsEnabled()) return 0;
  const currentTs = now();
  const toExpire = listLiveEventsByStatusStmt.all('active', 'active', 500).map(normalizeEventRow)
    .filter((row) => row.end_at <= currentTs);
  let expired = 0;
  for (const row of toExpire) {
    const result = setLiveEventStatusStmt.run('expired', currentTs, row.event_id);
    if (result.changes === 1) {
      expired += 1;
      insertAdminEventStmt.run(
        generateId('admin'),
        adminUserId,
        'live_event_auto_expire',
        JSON.stringify({ eventId: row.event_id }),
        currentTs
      );
    }
  }
  // Keep one-shot bulk fallback for any row now past end.
  const bulk = expireEndedEventsStmt.run(currentTs, currentTs);
  return expired + (bulk?.changes || 0);
});

export function getLiveEventAutocompleteChoices(query = '', limit = 25) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));
  const text = String(query || '').trim();
  const like = text ? `%${text}%` : '';
  const rows = autocompleteLiveEventsStmt.all(text, like, like, like, like, safeLimit).map(normalizeEventRow);
  return rows.map((row) => ({
    name: `${row.name} • ${row.effect_type} • ${row.status}${row.set_scope ? ` • ${row.set_scope.toUpperCase()}` : ' • GLOBAL'}`.slice(0, 100),
    value: row.event_id,
  }));
}

export function setAdminMultiplier(adminUserId, key, value) {
  if (!['credit_multiplier', 'drop_rate_event_multiplier'].includes(key)) {
    throw new Error('unknown multiplier key');
  }
  setTcgSetting(key, value);
  insertAdminEventStmt.run(generateId('admin'), adminUserId, 'set_multiplier', JSON.stringify({ key, value }), now());
}

export const rollbackSettledTrade = db.transaction((adminUserId, tradeId) => {
  const trade = getTradeStmt.get(tradeId);
  if (!trade) throw new Error('trade not found');
  if (trade.status !== 'settled') throw new Error(`trade is ${trade.status}`);

  const offerCards = JSON.parse(trade.offer_cards_json || '[]');
  const requestCards = JSON.parse(trade.request_cards_json || '[]');

  for (const instanceId of offerCards) {
    const row = getInstanceByIdStmt.get(instanceId);
    if (!row) throw new Error(`missing offered card ${instanceId}`);
    if (row.owner_user_id !== trade.offered_to_user_id || row.state !== 'owned') {
      throw new Error(`offered card cannot be rolled back: ${instanceId}`);
    }
  }
  for (const instanceId of requestCards) {
    const row = getInstanceByIdStmt.get(instanceId);
    if (!row) throw new Error(`missing requested card ${instanceId}`);
    if (row.owner_user_id !== trade.offered_by_user_id || row.state !== 'owned') {
      throw new Error(`requested card cannot be rolled back: ${instanceId}`);
    }
  }

  for (const instanceId of offerCards) {
    const moved = transferOwnedInstanceStmt.run(trade.offered_by_user_id, instanceId, trade.offered_to_user_id);
    if (moved.changes !== 1) throw new Error(`rollback failed transferring offered card ${instanceId}`);
  }
  for (const instanceId of requestCards) {
    const moved = transferOwnedInstanceStmt.run(trade.offered_to_user_id, instanceId, trade.offered_by_user_id);
    if (moved.changes !== 1) throw new Error(`rollback failed transferring requested card ${instanceId}`);
  }

  if ((trade.offer_credits || 0) > 0) {
    addCreditsInternal(trade.offered_to_user_id, -trade.offer_credits, 'trade_rollback_payback', tradeId);
    addCreditsInternal(trade.offered_by_user_id, trade.offer_credits, 'trade_rollback_receive', tradeId);
  }
  if ((trade.request_credits || 0) > 0) {
    addCreditsInternal(trade.offered_by_user_id, -trade.request_credits, 'trade_rollback_payback', tradeId);
    addCreditsInternal(trade.offered_to_user_id, trade.request_credits, 'trade_rollback_receive', tradeId);
  }

  setTradeStatusOrThrow(tradeId, 'settled', 'rolled_back');
  insertAdminEventStmt.run(
    generateId('admin'),
    adminUserId,
    'rollback_trade',
    JSON.stringify({ tradeId }),
    now()
  );
  return getTradeStmt.get(tradeId);
});

export function getTcgOverview(userId) {
  const wallet = getWalletInternal(userId);
  const invCount = db.prepare('SELECT COUNT(*) AS cnt FROM tcg_card_instances WHERE owner_user_id = ?').get(userId)?.cnt || 0;
  const claimableCount = db.prepare("SELECT COUNT(*) AS cnt FROM tcg_claimable_packs WHERE owner_user_id = ? AND status = 'claimable'").get(userId)?.cnt || 0;
  const unopenedCount = db.prepare("SELECT COUNT(*) AS cnt FROM tcg_claimable_packs WHERE owner_user_id = ? AND status = 'unopened'").get(userId)?.cnt || 0;
  const settings = getUserSettingsInternal(userId);
  return {
    wallet,
    inventoryCount: invCount,
    claimableCount,
    unopenedCount,
    autoClaimEnabled: settings.auto_claim_enabled === 1,
    cooldown: getFreePackAvailability(userId),
    events: getEffectiveEventEffects({}),
    tradeLocked: getTcgSetting('trade_locked', '0') === '1',
  };
}
