import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../src/server.mjs';

const directory = await mkdtemp(join(tmpdir(), 'smart-push-browser-'));
const upstream = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
});
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const serialized = { endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
let app, browser;
try {
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  app = await createApp({ upstream: `http://127.0.0.1:${upstream.address().port}`, token: 'browser-test', stateDir: directory, monitorEnabled: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  // Only the browser's push provider is simulated. UI, HTTP auth, subscription
  // validation and persistence run unchanged, with no external push recipient.
  await page.addInitScript(({ serialized }) => {
    if (localStorage.getItem('fixture-present') === null) localStorage.setItem('fixture-present', '1');
    window.pushFixture = { permissionRequests: 0, failUnsubscribe: false };
    const subscription = { endpoint: serialized.endpoint, toJSON: () => serialized, async unsubscribe() {
      if (window.pushFixture.failUnsubscribe) throw Error('Browser unsubscribe failed');
      localStorage.setItem('fixture-present', '0'); return true;
    } };
    const registration = { pushManager: {
      async getSubscription() { return localStorage.getItem('fixture-present') === '1' ? subscription : null; },
      async subscribe() { localStorage.setItem('fixture-present', '1'); return subscription; },
    } };
    Object.defineProperty(window, 'PushManager', { value: class {} });
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', async requestPermission() { window.pushFixture.permissionRequests++; return 'granted'; } } });
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(registration), async register() { await new Promise(resolve => setTimeout(resolve, 200)); return registration; } } });
  }, { serialized });
  await page.goto(`${origin}/?token=browser-test`);
  await page.waitForFunction(() => !document.querySelector('#smart-push').disabled);
  const devices = () => page.evaluate(async () => (await fetch('/_smart/api/status').then(r => r.json())).devices);
  assert.equal(await devices(), 1);
  assert.equal(await page.evaluate(() => window.pushFixture.permissionRequests), 0);
  console.log('PASS existing subscription restores at startup without opening settings or prompting');

  await page.click('#smart-settings');
  await page.waitForFunction(() => !document.querySelector('#smart-push').disabled);
  await page.evaluate(() => { window.pushFixture.failUnsubscribe = true; });
  await page.click('#smart-push');
  await page.waitForFunction(() => document.querySelector('#smart-message').textContent.includes('Browser unsubscribe failed'));
  assert.match(await page.textContent('#smart-push'), /無効にする/);
  assert.equal(await devices(), 1);
  console.log('PASS failed browser unsubscribe stays ON and reports the failure');

  await page.evaluate(() => { window.pushFixture.failUnsubscribe = false; });
  await page.click('#smart-push');
  await page.waitForFunction(() => document.querySelector('#smart-message').textContent.includes('無効にしました'));
  assert.equal(await devices(), 0);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#smart-push').disabled);
  assert.equal(await devices(), 0);
  assert.equal(await page.evaluate(() => window.pushFixture.permissionRequests), 0);
  console.log('PASS disabled device stays OFF after reload');

  await page.click('#smart-settings');
  await page.waitForFunction(() => !document.querySelector('#smart-push').disabled);
  await page.click('#smart-push');
  await page.waitForFunction(() => document.querySelector('#smart-message').textContent.includes('有効にしました'));
  assert.equal(await devices(), 1);
  assert.equal(await page.evaluate(() => window.pushFixture.permissionRequests), 1);
  console.log('PASS explicit enable registers device and requests permission once');

  await page.evaluate(async endpoint => { await fetch('/_smart/api/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Smart-ZCode': '1' }, body: JSON.stringify({ endpoint }) }); }, serialized.endpoint);
  assert.equal(await devices(), 0);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#smart-push').disabled);
  assert.equal(await devices(), 1);
  console.log('PASS reload restores a missing server subscription without a new permission prompt');
} finally {
  await browser?.close(); app?.close(); upstream.close();
  await rm(directory, { recursive: true, force: true });
}
