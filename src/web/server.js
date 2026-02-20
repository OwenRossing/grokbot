import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import {
  createLiveEvent,
  deleteLiveEvent,
  getEffectiveEventEffects,
  getInventoryPage,
  getTcgOverview,
  getTcgSetting,
  grantAdminCredits,
  grantAdminSealedPacks,
  listAdminEvents,
  listClaimablePacks,
  listLiveEvents,
  listUnopenedPacks,
  rollbackSettledTrade,
  setAdminMultiplier,
  setLiveEventStatus,
  setTradeLocked,
} from '../services/tcg/tcgStore.js';

function parseCookies(raw = '') {
  const out = {};
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      let size = 0;
      for (const c of chunks) size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(text);
      const body = {};
      for (const [key, val] of params.entries()) body[key] = val;
      resolve(body);
    });
    req.on('error', reject);
  });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function renderLayout({ title, body, message = '' }) {
  const banner = message
    ? `<p style="padding:10px;background:#f0f4ff;border:1px solid #b9c7ff;border-radius:6px;">${htmlEscape(message)}</p>`
    : '';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 24px auto; padding: 0 12px; color: #1a1a1a; background: linear-gradient(180deg,#f7f9ff,#ffffff 180px); }
    h1, h2 { margin: 0 0 10px; }
    .card { background: #fff; border: 1px solid #d8e1ff; border-radius: 10px; padding: 12px; margin: 12px 0; box-shadow: 0 2px 10px rgba(30,60,160,0.06); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(320px,1fr)); gap: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    input, button, select { padding: 8px; border-radius: 6px; border: 1px solid #b9c7ff; }
    button { background: #204dff; color: white; border: 0; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e7ebff; text-align: left; padding: 8px; font-size: 14px; vertical-align: top; }
    .nav a { margin-right: 10px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .muted { color: #5f6887; font-size: 13px; }
  </style>
</head>
<body>
  <div class="nav"><a href="/">Admin Dashboard</a><a href="/user">User Inspector</a><a href="/logout">Logout</a></div>
  ${banner}
  ${body}
</body>
</html>`;
}

function parseHash(hash) {
  if (!hash) return null;
  if (hash.startsWith('sha256:')) return { type: 'sha256', value: hash.slice('sha256:'.length) };
  if (hash.startsWith('scrypt:')) {
    const parts = hash.split(':');
    if (parts.length === 3) {
      return { type: 'scrypt', salt: parts[1], value: parts[2] };
    }
  }
  return { type: 'plain', value: hash };
}

function verifyPassword(input, config) {
  const safeEqual = (a, b) => {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  };

  const plain = String(config.password || '');
  if (plain) {
    return safeEqual(input, plain);
  }

  const parsed = parseHash(String(config.passwordHash || ''));
  if (!parsed) return false;
  if (parsed.type === 'sha256') {
    const digest = crypto.createHash('sha256').update(String(input)).digest('hex');
    return safeEqual(digest, parsed.value);
  }
  if (parsed.type === 'scrypt') {
    const key = crypto.scryptSync(String(input), parsed.salt, 64).toString('hex');
    return safeEqual(key, parsed.value);
  }
  return safeEqual(String(input), parsed.value);
}

function htmlDashboard(csrfToken, message = '') {
  const creditMultiplier = getTcgSetting('credit_multiplier', '1');
  const dropMultiplier = getTcgSetting('drop_rate_event_multiplier', '1');
  const tradeLocked = getTcgSetting('trade_locked', '0') === '1';
  const events = listAdminEvents(20);
  const liveEvents = listLiveEvents({ status: 'all', limit: 30 });
  const activeEffects = getEffectiveEventEffects({});

  return renderLayout({
    title: 'TCG Admin Dashboard',
    message,
    body: `
      <h1>TCG Admin Dashboard</h1>
      <p class="muted">Admin-only controls for granting packs/credits, trading policy, multipliers, and rollback operations.</p>

      <div class="grid">
        <div class="card">
          <h2>Grant Sealed Packs</h2>
          <form method="post" action="/admin/grant-pack">
            <input type="hidden" name="csrf_token" value="${csrfToken}" />
            <div class="row">
              <input name="user_id" placeholder="Target User ID" required />
              <input name="set_code" placeholder="Set code (e.g. sv1)" required />
            </div>
            <div class="row">
              <input name="quantity" value="1" />
              <input name="product_code" placeholder="Optional product code" />
            </div>
            <button type="submit">Grant Packs</button>
          </form>
        </div>

        <div class="card">
          <h2>Grant Credits</h2>
          <form method="post" action="/admin/grant-credits">
            <input type="hidden" name="csrf_token" value="${csrfToken}" />
            <div class="row">
              <input name="user_id" placeholder="Target User ID" required />
              <input name="credits" placeholder="Credit delta (can be negative)" required />
            </div>
            <button type="submit">Apply Credits</button>
          </form>
        </div>

        <div class="card">
          <h2>Trading Lock</h2>
          <p>Current: <b>${tradeLocked ? 'LOCKED' : 'UNLOCKED'}</b></p>
          <form method="post" action="/admin/trade-lock">
            <input type="hidden" name="csrf_token" value="${csrfToken}" />
            <div class="row">
              <select name="enabled">
                <option value="off" ${tradeLocked ? '' : 'selected'}>off</option>
                <option value="on" ${tradeLocked ? 'selected' : ''}>on</option>
              </select>
              <button type="submit">Update Lock</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>Multipliers</h2>
          <p>Credit: <b>${htmlEscape(creditMultiplier)}</b> • Drop Rate: <b>${htmlEscape(dropMultiplier)}</b></p>
          <form method="post" action="/admin/set-multiplier">
            <input type="hidden" name="csrf_token" value="${csrfToken}" />
            <div class="row">
              <select name="key">
                <option value="credit_multiplier">credit_multiplier</option>
                <option value="drop_rate_event_multiplier">drop_rate_event_multiplier</option>
              </select>
              <input name="value" placeholder="Value (e.g. 1.5)" required />
            </div>
            <button type="submit">Set Multiplier</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h2>Rollback Settled Trade</h2>
        <form method="post" action="/admin/rollback-trade">
          <input type="hidden" name="csrf_token" value="${csrfToken}" />
          <div class="row">
            <input name="trade_id" placeholder="Trade ID" class="mono" required />
            <button type="submit">Rollback Trade</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Live Events</h2>
        <p>Active effects:
          <b>${activeEffects.bonusPackCount > 0 ? `bonus +${activeEffects.bonusPackCount}` : 'no bonus pack'}</b> •
          <b>drop ${Number(activeEffects.dropBoostMultiplier || 1).toFixed(2)}x</b> •
          <b>credits ${Number(activeEffects.creditMultiplier || 1).toFixed(2)}x</b>
        </p>
        <form method="post" action="/admin/event-create">
          <input type="hidden" name="csrf_token" value="${csrfToken}" />
          <div class="row">
            <input name="name" placeholder="Event name" required />
            <select name="effect_type">
              <option value="bonus_pack">bonus_pack</option>
              <option value="drop_boost">drop_boost</option>
              <option value="credit_boost">credit_boost</option>
            </select>
            <input name="value" placeholder="Value (bonus 1-3, boost 1.0-3.0)" required />
          </div>
          <div class="row">
            <input name="start_unix" placeholder="Start unix (seconds)" required />
            <input name="end_unix" placeholder="End unix (seconds)" required />
            <input name="set_code" placeholder="Optional set scope (sv1)" />
            <select name="enabled">
              <option value="true" selected>enabled</option>
              <option value="false">disabled</option>
            </select>
            <button type="submit">Create Event</button>
          </div>
        </form>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Effect</th><th>Status</th><th>Scope</th><th>Window</th><th>Actions</th></tr></thead>
          <tbody>
            ${liveEvents.map((row) => `<tr>
              <td class="mono">${htmlEscape(row.event_id)}</td>
              <td>${htmlEscape(row.name)}</td>
              <td class="mono">${htmlEscape(row.effect_type)}=${htmlEscape(row.effect_value)}</td>
              <td>${htmlEscape(row.status)}</td>
              <td>${htmlEscape(row.set_scope || 'GLOBAL')}</td>
              <td>${new Date(row.start_at).toISOString()}<br/>${new Date(row.end_at).toISOString()}</td>
              <td>
                <form method="post" action="/admin/event-status" style="display:inline">
                  <input type="hidden" name="csrf_token" value="${csrfToken}" />
                  <input type="hidden" name="event_id" value="${htmlEscape(row.event_id)}" />
                  <input type="hidden" name="status" value="${row.status === 'disabled' ? 'active' : 'disabled'}" />
                  <button type="submit">${row.status === 'disabled' ? 'Enable' : 'Disable'}</button>
                </form>
                <form method="post" action="/admin/event-delete" style="display:inline">
                  <input type="hidden" name="csrf_token" value="${csrfToken}" />
                  <input type="hidden" name="event_id" value="${htmlEscape(row.event_id)}" />
                  <button type="submit">Delete</button>
                </form>
              </td>
            </tr>`).join('') || '<tr><td colspan="7">No live events.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Recent Admin Events</h2>
        <table>
          <thead><tr><th>Event ID</th><th>Action</th><th>Admin</th><th>When</th><th>Payload</th></tr></thead>
          <tbody>
            ${events.map((row) => `<tr>
              <td class="mono">${htmlEscape(row.event_id)}</td>
              <td>${htmlEscape(row.action)}</td>
              <td class="mono">${htmlEscape(row.admin_user_id)}</td>
              <td>${new Date(row.created_at).toISOString()}</td>
              <td class="mono">${htmlEscape(row.payload_json || '{}')}</td>
            </tr>`).join('') || '<tr><td colspan="5">No events.</td></tr>'}
          </tbody>
        </table>
      </div>
    `,
  });
}

function htmlUserInspector(userId, page, setCode, filter, message = '') {
  const targetUserId = String(userId || '').trim();
  const safePage = Math.max(1, Number.parseInt(String(page || '1'), 10) || 1);
  const safeSet = String(setCode || '').trim().toLowerCase();
  const safeFilter = String(filter || '').trim();

  const overview = targetUserId ? getTcgOverview(targetUserId) : null;
  const inv = targetUserId
    ? getInventoryPage({ userId: targetUserId, page: safePage, pageSize: 25, setCode: safeSet, nameLike: safeFilter })
    : null;
  const claimable = targetUserId ? listClaimablePacks(targetUserId, 25) : [];
  const unopened = targetUserId ? listUnopenedPacks(targetUserId, 25) : [];

  return renderLayout({
    title: 'User Inspector',
    message,
    body: `
      <h1>User Inspector</h1>
      <div class="card">
        <form method="get" action="/user">
          <div class="row">
            <input name="user_id" placeholder="User ID" value="${htmlEscape(targetUserId)}" required />
            <input name="set_code" placeholder="Set filter" value="${htmlEscape(safeSet)}" />
            <input name="filter" placeholder="Name filter" value="${htmlEscape(safeFilter)}" />
            <input name="page" value="${safePage}" />
            <button type="submit">Inspect User</button>
          </div>
        </form>
      </div>

      ${targetUserId && overview ? `
      <div class="grid">
        <div class="card">
          <h2>Overview</h2>
          <p>User: <span class="mono">${htmlEscape(targetUserId)}</span></p>
          <p>Credits: <b>${overview.wallet.credits}</b></p>
          <p>Opened packs: <b>${overview.wallet.opened_count}</b></p>
          <p>Streak: <b>${overview.wallet.streak_days}</b></p>
          <p>Inventory count: <b>${overview.inventoryCount}</b></p>
          <p>Claimable: <b>${overview.claimableCount}</b> • Unopened: <b>${overview.unopenedCount}</b></p>
          <p>Free pack: ${overview.cooldown.available ? 'ready' : `in ${Math.ceil(overview.cooldown.availableInMs / 1000)}s`}</p>
        </div>

        <div class="card">
          <h2>Claimable Packs</h2>
          <table>
            <thead><tr><th>Pack ID</th><th>Set</th><th>Source</th><th>Granted At</th></tr></thead>
            <tbody>
              ${claimable.map((row) => `<tr>
                <td class="mono">${htmlEscape(row.pack_id)}</td>
                <td>${htmlEscape(row.set_code)}</td>
                <td>${htmlEscape(row.grant_source || '')}</td>
                <td>${new Date(row.granted_at).toISOString()}</td>
              </tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Unopened Packs</h2>
          <table>
            <thead><tr><th>Pack ID</th><th>Set</th><th>Source</th><th>Claimed At</th></tr></thead>
            <tbody>
              ${unopened.map((row) => `<tr>
                <td class="mono">${htmlEscape(row.pack_id)}</td>
                <td>${htmlEscape(row.set_code)}</td>
                <td>${htmlEscape(row.grant_source || '')}</td>
                <td>${row.claimed_at ? new Date(row.claimed_at).toISOString() : '-'}</td>
              </tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Inventory</h2>
        <p>${inv.total} cards • page ${inv.page}/${inv.totalPages}</p>
        <table>
          <thead><tr><th>Instance</th><th>Card</th><th>Set</th><th>Rarity</th><th>State</th></tr></thead>
          <tbody>
            ${inv.rows.map((row) => `<tr>
              <td class="mono">${htmlEscape(row.instance_id)}</td>
              <td>${htmlEscape(row.name)}</td>
              <td>${htmlEscape(row.set_code)}</td>
              <td>${htmlEscape(row.rarity)}</td>
              <td>${htmlEscape(row.state)}</td>
            </tr>`).join('') || '<tr><td colspan="5">No cards</td></tr>'}
          </tbody>
        </table>
      </div>
      ` : ''}
    `,
  });
}

export function startWebServer() {
  const enabledRaw = String(process.env.WEB_UI_ENABLED || '').toLowerCase();
  const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'on' || enabledRaw === 'yes';
  if (!enabled) {
    return { close: async () => {} };
  }

  const adminUser = String(process.env.WEB_UI_ADMIN_USER || '').trim();
  const passwordHash = String(process.env.WEB_UI_ADMIN_PASSWORD_HASH || '').trim();
  const password = String(process.env.WEB_UI_ADMIN_PASSWORD || '').trim();
  if (!adminUser || (!passwordHash && !password)) {
    console.warn('WEB_UI_ENABLED is true but WEB_UI_ADMIN_USER and WEB_UI_ADMIN_PASSWORD_HASH/WEB_UI_ADMIN_PASSWORD are missing. Web UI disabled.');
    return { close: async () => {} };
  }

  const adminActorId = String(process.env.WEB_UI_ADMIN_ACTOR_ID || process.env.SUPER_ADMIN_USER_ID || 'web_ui_admin');
  const host = String(process.env.WEB_UI_HOST || '0.0.0.0').trim();
  const port = Number.parseInt(process.env.WEB_UI_PORT || '8787', 10);
  const sessions = new Map();

  const createSession = () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { csrfToken, createdAt: Date.now(), updatedAt: Date.now() });
    return { sid, csrfToken };
  };

  const getSession = (req) => {
    const sid = parseCookies(req.headers.cookie || '').tcg_sid;
    if (!sid) return null;
    const session = sessions.get(sid);
    if (!session) return null;
    session.updatedAt = Date.now();
    return { sid, ...session };
  };

  const requireAuth = (req, res) => {
    const session = getSession(req);
    if (!session) {
      redirect(res, '/login');
      return null;
    }
    return session;
  };

  const requireCsrf = (session, body) => body?.csrf_token && body.csrf_token === session.csrfToken;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/login') {
        const html = renderLayout({
          title: 'Login',
          body: `
            <h1>TCG Admin Login</h1>
            <div class="card">
              <form method="post" action="/login">
                <input name="username" placeholder="Username" required />
                <input name="password" type="password" placeholder="Password" required />
                <button type="submit">Login</button>
              </form>
            </div>
          `,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/login') {
        const body = await readBody(req);
        const username = String(body.username || '').trim();
        const passwordInput = String(body.password || '');
        if (username === adminUser && verifyPassword(passwordInput, { passwordHash, password })) {
          const session = createSession();
          res.setHeader('Set-Cookie', `tcg_sid=${encodeURIComponent(session.sid)}; HttpOnly; SameSite=Lax; Path=/`);
          redirect(res, '/');
          return;
        }
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLayout({ title: 'Login Failed', body: '<h1>Login failed</h1><p>Invalid credentials.</p>' }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/logout') {
        const sid = parseCookies(req.headers.cookie || '').tcg_sid;
        if (sid) sessions.delete(sid);
        res.setHeader('Set-Cookie', 'tcg_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        redirect(res, '/login');
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const session = requireAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlDashboard(session.csrfToken, url.searchParams.get('message') || ''));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/user') {
        const session = requireAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          htmlUserInspector(
            url.searchParams.get('user_id') || '',
            url.searchParams.get('page') || '1',
            url.searchParams.get('set_code') || '',
            url.searchParams.get('filter') || '',
            url.searchParams.get('message') || ''
          )
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/grant-pack') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const userId = String(body.user_id || '').trim();
        const setCode = String(body.set_code || '').trim().toLowerCase();
        const quantity = Number.parseInt(String(body.quantity || '1'), 10);
        const productCode = String(body.product_code || '').trim();
        grantAdminSealedPacks(adminActorId, userId, { setCode, quantity, productCode });
        redirect(res, '/?message=Granted sealed packs.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/grant-credits') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const userId = String(body.user_id || '').trim();
        const credits = Number.parseInt(String(body.credits || '0'), 10);
        grantAdminCredits(adminActorId, userId, credits, 'web_admin_grant_credits');
        redirect(res, '/?message=Updated credits.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/set-multiplier') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const key = String(body.key || '').trim();
        const value = String(body.value || '').trim();
        setAdminMultiplier(adminActorId, key, value);
        redirect(res, '/?message=Multiplier updated.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/trade-lock') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const enabled = String(body.enabled || '').toLowerCase() === 'on';
        setTradeLocked(adminActorId, enabled);
        redirect(res, '/?message=Trade lock updated.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/rollback-trade') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const tradeId = String(body.trade_id || '').trim();
        rollbackSettledTrade(adminActorId, tradeId);
        redirect(res, '/?message=Trade rolled back.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/event-create') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        createLiveEvent(adminActorId, {
          name: String(body.name || '').trim(),
          effectType: String(body.effect_type || '').trim().toLowerCase(),
          effectValue: String(body.value || '').trim(),
          setScope: String(body.set_code || '').trim().toLowerCase(),
          startAt: (Number.parseInt(String(body.start_unix || '0'), 10) || 0) * 1000,
          endAt: (Number.parseInt(String(body.end_unix || '0'), 10) || 0) * 1000,
          enabled: String(body.enabled || 'true').toLowerCase() !== 'false',
        });
        redirect(res, '/?message=Created live event.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/event-status') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const eventId = String(body.event_id || '').trim();
        const status = String(body.status || '').trim().toLowerCase();
        setLiveEventStatus(adminActorId, eventId, status);
        redirect(res, '/?message=Updated live event status.');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/admin/event-delete') {
        const session = requireAuth(req, res);
        if (!session) return;
        const body = await readBody(req);
        if (!requireCsrf(session, body)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('CSRF check failed');
          return;
        }
        const eventId = String(body.event_id || '').trim();
        deleteLiveEvent(adminActorId, eventId);
        redirect(res, '/?message=Deleted live event.');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Server error: ${err.message || err}`);
    }
  });

  server.listen(port, host, () => {
    console.log(`TCG web UI listening on http://${host}:${port}`);
  });

  return {
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
