import http from 'node:http';
import { URL } from 'node:url';
import { getNetWorthLeaderboard } from '../services/markets/leaderboardService.js';
import { ensureActiveSeason, listCachedMarkets } from '../services/markets/store.js';

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDashboard() {
  const season = ensureActiveSeason(Date.now());
  const markets = listCachedMarkets({ status: 'all', limit: 20 });
  const leaderboard = getNetWorthLeaderboard(season.season_id, 10);

  const marketRows = markets.length
    ? markets.map((row) => `
      <tr>
        <td class="mono">${htmlEscape(row.ticker)}</td>
        <td>${htmlEscape(row.title)}</td>
        <td>${htmlEscape(row.category || 'general')}</td>
        <td>${htmlEscape(row.status || 'unknown')}</td>
        <td>${Number.isFinite(Number(row.yes_price)) ? `${Math.round(Number(row.yes_price))}¢` : '—'}</td>
        <td>${Number.isFinite(Number(row.no_price)) ? `${Math.round(Number(row.no_price))}¢` : '—'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">No cached markets yet.</td></tr>';

  const leaderboardRows = leaderboard.length
    ? leaderboard.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td class="mono">${htmlEscape(row.user_id)}</td>
        <td>$${Number(row.net_worth || 0).toFixed(2)}</td>
        <td>$${Number(row.realized_pnl || 0).toFixed(2)}</td>
        <td>${Number(row.trades || 0)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">No leaderboard entries yet.</td></tr>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grokbot Management</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 24px auto; padding: 0 12px; color: #1a1a1a; background: #f8f9fc; }
    h1, h2 { margin: 0 0 10px; }
    .card { background: #fff; border: 1px solid #d9e0f2; border-radius: 10px; padding: 12px; margin: 12px 0; box-shadow: 0 1px 6px rgba(17,24,39,0.06); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #eef2ff; text-align: left; padding: 8px; font-size: 14px; vertical-align: top; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .muted { color: #5f6887; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(280px,1fr)); gap: 12px; }
  </style>
</head>
<body>
  <h1>Grokbot Management Dashboard</h1>
  <p class="muted">Read-only operational view for prediction markets runtime.</p>

  <div class="grid">
    <div class="card">
      <h2>Runtime</h2>
      <p>Node: <b>${htmlEscape(process.version)}</b></p>
      <p>PID: <b>${process.pid}</b></p>
      <p>Uptime: <b>${Math.floor(process.uptime())}s</b></p>
    </div>
    <div class="card">
      <h2>Season</h2>
      <p>ID: <b class="mono">${htmlEscape(season.season_id)}</b></p>
      <p>Starts: <b>${new Date(season.starts_at).toISOString()}</b></p>
      <p>Ends: <b>${new Date(season.ends_at).toISOString()}</b></p>
    </div>
    <div class="card">
      <h2>Features</h2>
      <p>Markets: <b>${String(process.env.FEATURE_MARKETS_ENABLED || '1')}</b></p>
      <p>Command Scope: <b>${htmlEscape(process.env.COMMAND_REGISTRATION_SCOPE || 'guild')}</b></p>
      <p>Sync Interval: <b>${htmlEscape(process.env.MARKETS_SYNC_MS || '60000')} ms</b></p>
    </div>
  </div>

  <div class="card">
    <h2>Cached Markets</h2>
    <table>
      <thead><tr><th>Ticker</th><th>Title</th><th>Category</th><th>Status</th><th>YES</th><th>NO</th></tr></thead>
      <tbody>${marketRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Leaderboard (Net Worth)</h2>
    <table>
      <thead><tr><th>#</th><th>User</th><th>Net Worth</th><th>Realized PnL</th><th>Trades</th></tr></thead>
      <tbody>${leaderboardRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function startWebServer() {
  const enabled = ['1', 'true', 'on', 'yes'].includes(String(process.env.WEB_UI_ENABLED || '0').toLowerCase());
  if (!enabled) {
    return {
      close: async () => {},
    };
  }

  const host = process.env.WEB_UI_HOST || '0.0.0.0';
  const port = Number.parseInt(process.env.WEB_UI_PORT || '8787', 10) || 8787;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      const season = ensureActiveSeason(Date.now());
      const markets = listCachedMarkets({ status: 'all', limit: 10 });
      const leaderboard = getNetWorthLeaderboard(season.season_id, 10);
      sendJson(res, 200, {
        ok: true,
        season,
        markets,
        leaderboard,
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const html = buildDashboard();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(port, host, () => {
    console.log(`Management web UI listening on http://${host}:${port}`);
  });

  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
