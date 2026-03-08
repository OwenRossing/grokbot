import test from 'node:test';
import assert from 'node:assert/strict';

import { startWebServer } from '../src/web/server.js';

const ORIGINAL_ENV = {
  WEB_UI_ENABLED: process.env.WEB_UI_ENABLED,
  WEB_UI_HOST: process.env.WEB_UI_HOST,
  WEB_UI_PORT: process.env.WEB_UI_PORT,
  WEB_UI_ADMIN_USER: process.env.WEB_UI_ADMIN_USER,
  WEB_UI_ADMIN_PASSWORD: process.env.WEB_UI_ADMIN_PASSWORD,
  WEB_UI_ADMIN_PASSWORD_HASH: process.env.WEB_UI_ADMIN_PASSWORD_HASH,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('web admin endpoints require auth and csrf for write actions', async (t) => {
  const port = 8900 + Math.floor(Math.random() * 300);
  process.env.WEB_UI_ENABLED = '1';
  process.env.WEB_UI_HOST = '127.0.0.1';
  process.env.WEB_UI_PORT = String(port);
  process.env.WEB_UI_ADMIN_USER = 'admin';
  process.env.WEB_UI_ADMIN_PASSWORD = 'pass123';
  delete process.env.WEB_UI_ADMIN_PASSWORD_HASH;

  const calls = { refresh: 0 };
  const server = startWebServer({
    adminOps: {
      refreshCommandsNow: async () => {
        calls.refresh += 1;
        return { ok: true, message: 'Commands refreshed', details: { count: 5 } };
      },
      syncMarketsNow: async () => ({ ok: true, message: 'sync', details: {} }),
      softRestartNow: async () => ({ ok: true, message: 'restart', details: {} }),
    },
  });

  t.after(async () => {
    await server.close();
    restoreEnv();
  });

  const base = `http://127.0.0.1:${port}`;

  const unauth = await fetch(`${base}/api/summary`, { redirect: 'manual' });
  assert.equal(unauth.status, 302);

  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: 'admin', password: 'pass123' }),
    redirect: 'manual',
  });
  assert.equal(login.status, 302);
  const setCookie = login.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('gb_sid='));
  const cookie = setCookie.split(';')[0];

  const page = await fetch(`${base}/`, {
    headers: { cookie },
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  const match = html.match(/name="csrf_token" value="([a-f0-9]+)"/i);
  assert.ok(match?.[1]);
  const csrf = match[1];

  const missingCsrf = await fetch(`${base}/api/admin/refresh-commands`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(missingCsrf.status, 403);

  const ok = await fetch(`${base}/api/admin/refresh-commands`, {
    method: 'POST',
    headers: {
      cookie,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert.equal(ok.status, 200);
  const json = await ok.json();
  assert.equal(json.ok, true);
  assert.equal(calls.refresh, 1);
});
