import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function parseHash(hash = '') {
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

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(input, config) {
  const plain = String(config.password || '');
  if (plain) return safeEqual(input, plain);

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

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readBody(req) {
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
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(text || '{}'));
          return;
        } catch {
          resolve({});
          return;
        }
      }
      const params = new URLSearchParams(text);
      const body = {};
      for (const [key, val] of params.entries()) body[key] = val;
      resolve(body);
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function buildSummary() {
  return {
    runtime: {
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      commandScope: process.env.COMMAND_REGISTRATION_SCOPE || 'guild',
    },
  };
}

function renderLoginPage(message = '') {
  const banner = message
    ? `<p style="padding:10px;background:#fff4e5;border:1px solid #ffd9a3;border-radius:6px;">${htmlEscape(message)}</p>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grokbot Login</title>
  <style>
    body { font-family: ui-sans-serif, system-ui; max-width: 460px; margin: 60px auto; padding: 0 12px; background: #f8f9fc; }
    .card { background: #fff; border: 1px solid #d9e0f2; border-radius: 10px; padding: 16px; }
    input, button { width: 100%; box-sizing: border-box; margin: 8px 0; padding: 10px; }
    button { background:#204dff; color:#fff; border:0; border-radius:6px; cursor:pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Grokbot Admin</h1>
    ${banner}
    <form method="post" action="/login">
      <input name="user" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

function renderDashboard({ summary, csrfToken, message = '' }) {
  const banner = message
    ? `<p style="padding:10px;background:#eef8ff;border:1px solid #b7ddff;border-radius:6px;">${htmlEscape(message)}</p>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grokbot Management</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system; max-width: 1200px; margin: 24px auto; padding: 0 12px; color: #1a1a1a; background: #f8f9fc; }
    h1, h2 { margin: 0 0 10px; }
    .card { background: #fff; border: 1px solid #d9e0f2; border-radius: 10px; padding: 12px; margin: 12px 0; box-shadow: 0 1px 6px rgba(17,24,39,0.06); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #eef2ff; text-align: left; padding: 8px; font-size: 14px; vertical-align: top; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .muted { color: #5f6887; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(280px,1fr)); gap: 12px; }
    form.inline { display: inline-block; margin-right: 8px; }
    button { background:#204dff; color:#fff; border:0; border-radius:6px; cursor:pointer; padding:8px 10px; }
    .danger { background:#d93a3a; }
  </style>
</head>
<body>
  <h1>Grokbot Management Dashboard</h1>
  <p class="muted">Admin controls + operational overview.</p>
  ${banner}

  <div class="card">
    <form class="inline" method="post" action="/admin/refresh-commands">
      <input type="hidden" name="csrf_token" value="${csrfToken}" />
      <button type="submit">Refresh Slash Commands</button>
    </form>
    <form class="inline" method="post" action="/admin/restart">
      <input type="hidden" name="csrf_token" value="${csrfToken}" />
      <button class="danger" type="submit">Soft Restart Bot</button>
    </form>
    <a style="margin-left:12px" href="/logout">Logout</a>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Runtime</h2>
      <p>Node: <b>${htmlEscape(summary.runtime.node)}</b></p>
      <p>PID: <b>${summary.runtime.pid}</b></p>
      <p>Uptime: <b>${summary.runtime.uptimeSeconds}s</b></p>
    </div>
    <div class="card">
      <h2>Config</h2>
      <p>Command Scope: <b>${htmlEscape(summary.runtime.commandScope)}</b></p>
    </div>
  </div>

</body>
</html>`;
}

export function startWebServer({ adminOps = {} } = {}) {
  const enabled = ['1', 'true', 'on', 'yes'].includes(String(process.env.WEB_UI_ENABLED || '0').toLowerCase());
  if (!enabled) {
    return { close: async () => {} };
  }

  const host = process.env.WEB_UI_HOST || '0.0.0.0';
  const port = Number.parseInt(process.env.WEB_UI_PORT || '8787', 10) || 8787;
  const authConfig = {
    user: String(process.env.WEB_UI_ADMIN_USER || 'admin'),
    password: String(process.env.WEB_UI_ADMIN_PASSWORD || ''),
    passwordHash: String(process.env.WEB_UI_ADMIN_PASSWORD_HASH || ''),
  };

  const sessions = new Map();

  const createSession = (user) => {
    const sid = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { sid, user, csrfToken, expiresAt: now() + SESSION_TTL_MS });
    return { sid, csrfToken };
  };

  const getSession = (req) => {
    const sid = parseCookies(req.headers.cookie || '').gb_sid;
    if (!sid) return null;
    const entry = sessions.get(sid);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      sessions.delete(sid);
      return null;
    }
    entry.expiresAt = now() + SESSION_TTL_MS;
    return entry;
  };

  const clearSessionCookie = (res) => {
    res.setHeader('Set-Cookie', 'gb_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  };

  const requireSession = (req, res) => {
    const session = getSession(req);
    if (!session) {
      redirect(res, '/login');
      return null;
    }
    return session;
  };

  const checkCsrf = (session, req, body = {}) => {
    const headerToken = String(req.headers['x-csrf-token'] || '').trim();
    const bodyToken = String(body.csrf_token || '').trim();
    const token = headerToken || bodyToken;
    return token && token === session.csrfToken;
  };

  const runAdminAction = async (fn, fallbackName = 'action') => {
    if (typeof fn !== 'function') {
      return { ok: false, message: `${fallbackName} unavailable`, details: {} };
    }
    try {
      return await fn();
    } catch (err) {
      return { ok: false, message: `${fallbackName} failed`, details: { error: err.message } };
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, message: 'healthy', details: { pid: process.pid } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/login') {
      const existing = getSession(req);
      if (existing) {
        redirect(res, '/');
        return;
      }
      const message = url.searchParams.get('message') || '';
      const html = renderLoginPage(message);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/login') {
      const body = await readBody(req);
      const user = String(body.user || '').trim();
      const password = String(body.password || '');
      const hasConfiguredPassword = Boolean(authConfig.password || authConfig.passwordHash);
      if (!hasConfiguredPassword || user !== authConfig.user || !verifyPassword(password, authConfig)) {
        redirect(res, '/login?message=Invalid%20credentials');
        return;
      }
      const session = createSession(user);
      res.setHeader('Set-Cookie', `gb_sid=${encodeURIComponent(session.sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
      redirect(res, '/');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/logout') {
      const sid = parseCookies(req.headers.cookie || '').gb_sid;
      if (sid) sessions.delete(sid);
      clearSessionCookie(res);
      redirect(res, '/login?message=Logged%20out');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      const session = requireSession(req, res);
      if (!session) return;
      json(res, 200, { ok: true, message: 'summary', details: buildSummary() });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/admin/')) {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      if (!checkCsrf(session, req, body)) {
        json(res, 403, { ok: false, message: 'invalid csrf token', details: {} });
        return;
      }

      let result;
      if (url.pathname === '/api/admin/refresh-commands') {
        result = await runAdminAction(adminOps.refreshCommandsNow, 'refresh-commands');
      } else if (url.pathname === '/api/admin/restart') {
        result = await runAdminAction(adminOps.softRestartNow, 'restart');
      } else {
        json(res, 404, { ok: false, message: 'not found', details: {} });
        return;
      }
      json(res, result.ok ? 200 : 500, result);
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/admin/')) {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      if (!checkCsrf(session, req, body)) {
        redirect(res, '/?message=Invalid%20CSRF%20token');
        return;
      }

      let result;
      if (url.pathname === '/admin/refresh-commands') {
        result = await runAdminAction(adminOps.refreshCommandsNow, 'refresh-commands');
      } else if (url.pathname === '/admin/restart') {
        result = await runAdminAction(adminOps.softRestartNow, 'restart');
      } else {
        redirect(res, '/?message=Unknown%20admin%20action');
        return;
      }

      redirect(res, `/?message=${encodeURIComponent(result.message || (result.ok ? 'OK' : 'Failed'))}`);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const session = requireSession(req, res);
      if (!session) return;
      const html = renderDashboard({
        summary: buildSummary(),
        csrfToken: session.csrfToken,
        message: url.searchParams.get('message') || '',
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    json(res, 404, { ok: false, message: 'not found', details: {} });
  });

  server.listen(port, host, () => {
    console.log(`Management web UI listening on http://${host}:${port}`);
  });

  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
