import http from 'node:http';
import https from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createPush, resolvePushSubject } from './push.mjs';
import { startMonitor } from './monitor.mjs';
import { createSettings } from './settings.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const cookieName = 'smart_zcode_token';
function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); }
function cookie(req) { try { return decodeURIComponent(req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''); } catch { return ''; } }
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw Object.assign(Error('Request too large'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function createApp({ upstream, token, stateDir, publicOrigin, monitorEnabled = true, subject }) {
  if (!token) throw Error('ZCODE_TOKEN is required');
  upstream = new URL(upstream);
  if (!['http:', 'https:'].includes(upstream.protocol)) throw Error('Unsupported ZCODE_URL');
  if (upstream.username || upstream.password) throw Error('Use ZCODE_TOKEN, not credentials in ZCODE_URL');
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw Error('SMART_PUBLIC_ORIGIN must be an HTTP(S) origin');
    publicOrigin = parsed.origin;
  }
  upstream.search = ''; upstream.hash = '';
  const push = await createPush(stateDir, resolvePushSubject(subject, publicOrigin));
  const settings = await createSettings(stateDir);
  const monitor = monitorEnabled ? startMonitor(upstream, token, push) : { status: () => ({ connected: false }), stop() {} };
  const authenticated = req => equal(cookie(req), token);
  const validOrigin = req => {
    if (!req.headers.origin) return !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin';
    try { const origin = new URL(req.headers.origin); return publicOrigin ? origin.origin === publicOrigin : origin.host === req.headers.host; } catch { return false; }
  };
  const assets = {
    '/_smart/mobile.js': ['mobile.js', 'text/javascript'],
    '/_smart/mobile.css': ['mobile.css', 'text/css'],
    '/_smart/sw.js': ['sw.js', 'text/javascript'],
    '/_smart/icon.svg': ['icon.svg', 'image/svg+xml'],
    '/_smart/icon-192.png': ['icon-192.png', 'image/png'],
    '/_smart/icon-512.png': ['icon-512.png', 'image/png'],
    '/_smart/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.setHeader('Cache-Control', 'no-store');
      const login = () => {
        const secure = publicOrigin?.startsWith('https:') || req.headers['x-forwarded-proto'] === 'https';
        res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`, 'Cache-Control': 'no-store' });
        res.end();
      };
      if (url.pathname === '/_smart/login') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        if (!validOrigin(req) || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return json(res, 403, { error: 'Origin or content type rejected' });
        if (!equal(new URLSearchParams(await readBody(req)).get('token'), token)) return json(res, 401, { error: 'Invalid token' });
        return login();
      }
      if (url.searchParams.has('token')) {
        if (!equal(url.searchParams.get('token'), token)) return json(res, 401, { error: 'Invalid token' });
        return login();
      }
      const asset = assets[url.pathname];
      const publicAsset = asset && !['mobile.js', 'mobile.css'].includes(asset[0]);
      if (!publicAsset && !authenticated(req)) {
        if (req.headers.accept?.includes('text/html')) {
          // no-referrer makes browser form POSTs send Origin: null. The clean
          // login page can safely retain a same-origin referrer for CSRF checks.
          res.setHeader('Referrer-Policy', 'same-origin');
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end('<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart ZCode</title><body style="font:16px system-ui;background:#14171b;color:#eee;max-width:28rem;margin:15vh auto;padding:24px"><h1>Smart ZCode</h1><p>Connect using your ZCode access token.</p><form method="post" action="/_smart/login"><label>Access token <input name="token" type="password" required autocomplete="current-password" style="display:block;width:90%;padding:14px;margin:16px 0"></label><button style="padding:12px 24px">Connect</button></form></body></html>');
        }
        return json(res, 401, { error: 'Authentication required' });
      }
      // Address-bar/bookmark navigation has no Origin and Sec-Fetch-Site: none.
      // This exception is only for a top-level read, never API writes or upgrades.
      const directNavigation = ['GET', 'HEAD'].includes(req.method) && !req.headers.origin && req.headers['sec-fetch-site'] === 'none' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (!publicAsset && !directNavigation && !validOrigin(req)) return json(res, 403, { error: 'Origin rejected' });
      if (asset) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', ...(asset[0] === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
        return res.end(req.method === 'HEAD' ? undefined : await readFile(resolve(publicDir, asset[0])));
      }
      if (url.pathname.startsWith('/_smart/api/')) {
        if (req.method === 'GET' && url.pathname === '/_smart/api/status') return json(res, 200, { ...monitor.status(), devices: push.count(), publicKey: push.publicKey, settings: settings.get() });
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        if (!validOrigin(req) || req.headers['x-smart-zcode'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Origin rejected' });
        const data = JSON.parse(await readBody(req));
        if (url.pathname === '/_smart/api/settings') return json(res, 200, { settings: await settings.update(data) });
        if (url.pathname === '/_smart/api/subscribe') await push.subscribe(data);
        else if (url.pathname === '/_smart/api/unsubscribe') await push.unsubscribe(data.endpoint);
        else if (url.pathname === '/_smart/api/test') return json(res, 200, { ok: await push.test(data.endpoint) });
        else return json(res, 404, { error: 'Unknown endpoint' });
        return json(res, 200, { ok: true });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !validOrigin(req)) return json(res, 403, { error: 'Origin rejected' });
      const headers = { ...req.headers, host: upstream.host, cookie: `zcode_lite_token=${encodeURIComponent(token)}`, 'accept-encoding': 'identity' };
      delete headers['if-none-match']; delete headers['if-modified-since']; delete headers['x-forwarded-host'];
      const transport = upstream.protocol === 'https:' ? https : http;
      const target = new URL(upstream); target.pathname = url.pathname; target.search = url.search;
      const proxy = transport.request(target, { method: req.method, headers }, response => {
        const outputHeaders = { ...response.headers };
        delete outputHeaders['set-cookie'];
        for (const name of Object.keys(outputHeaders)) if (name.startsWith('access-control-')) delete outputHeaders[name];
        outputHeaders['cache-control'] = 'no-store';
        outputHeaders['x-frame-options'] = 'DENY';
        outputHeaders['content-security-policy'] = [...[response.headers['content-security-policy'] || []].flat(), "frame-ancestors 'none'"];
        const html = response.headers['content-type']?.includes('text/html') && req.method !== 'HEAD';
        if (!html) { res.writeHead(response.statusCode, outputHeaders); response.pipe(res); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) response.destroy(); else chunks.push(chunk); });
        response.on('end', () => {
          let text = Buffer.concat(chunks).toString();
          text = text.replace(/<meta\s+name="viewport"[^>]*>/i, '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">');
          text = text.replace('</head>', '<link rel="manifest" href="/_smart/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/_smart/icon.svg?v=3"><link rel="apple-touch-icon" href="/_smart/icon-192.png?v=3"><link rel="stylesheet" href="/_smart/mobile.css"><script src="/_smart/mobile.js" defer></script></head>');
          delete outputHeaders['content-length']; delete outputHeaders.etag; delete outputHeaders['content-encoding'];
          outputHeaders['cache-control'] = 'no-store'; res.writeHead(response.statusCode, outputHeaders); res.end(text);
        });
        response.on('error', () => res.destroy());
      });
      proxy.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'ZCode に接続できません。ZCode --web の起動と接続先を確認してください。' }); else res.destroy(); });
      proxy.setTimeout(30000, () => proxy.destroy(Error('Upstream timeout')));
      req.on('aborted', () => proxy.destroy()); req.pipe(proxy);
    } catch (error) { if (!res.headersSent) json(res, error.status === 413 ? 413 : 400, { error: error.message }); else res.destroy(); }
  });
  // Allow slow mobile uploads; the upstream inactivity limit remains 30 seconds.
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!authenticated(req) || !validOrigin(req) || new URL(req.url, 'http://localhost').pathname !== '/ws') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, client => {
      const url = new URL('/ws', upstream); url.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
      const remote = new WebSocket(url, { headers: { Cookie: `zcode_lite_token=${encodeURIComponent(token)}` }, handshakeTimeout: 10000, maxPayload: 32 * 1024 * 1024 });
      let queued = [], bytes = 0;
      client.on('message', (data, binary) => { if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary }); else if (remote.readyState === WebSocket.CONNECTING) { bytes += data.length; if (bytes > 1024 * 1024) { remote.terminate(); client.close(1009); } else queued.push([data, binary]); } });
      remote.on('open', () => { if (client.readyState !== WebSocket.OPEN) return remote.close(); for (const [data, binary] of queued) remote.send(data, { binary }); queued = []; });
      remote.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
      remote.on('error', () => client.close(1011, 'ZCode connection failed'));
      client.on('error', () => remote.terminate());
      client.on('close', () => remote.terminate());
      remote.on('close', () => client.close(1012, 'Reconnect to ZCode'));
    });
  });
  return { server, monitor, close: () => { monitor.stop(); for (const client of wss.clients) client.terminate(); wss.close(); server.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp({ upstream: process.env.ZCODE_URL || 'http://127.0.0.1:33113', token: process.env.ZCODE_TOKEN, stateDir: resolve(process.env.SMART_STATE_DIR || '.state'), publicOrigin: process.env.SMART_PUBLIC_ORIGIN, subject: process.env.VAPID_SUBJECT });
  const port = Number(process.env.SMART_PORT || 33114), host = process.env.SMART_HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`Smart ZCode: http://${host}:${port} (token required)`));
  app.server.on('error', error => { console.error(error.message); app.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.close(); });
}
