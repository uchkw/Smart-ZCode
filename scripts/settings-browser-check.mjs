import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../src/server.mjs';

const directory = await mkdtemp(join(tmpdir(), 'smart-settings-browser-'));
const upstream = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div>
    <button data-testid="v4-stop">Stop</button><input id="editor"><script>
    window.stopCount = 0;
    document.querySelector('button').onclick = () => window.stopCount++;
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) window.stopCount++; });
    </script></body></html>`);
});
let app, browser;
try {
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  app = await createApp({ upstream: `http://127.0.0.1:${upstream.address().port}`, token: 'browser-test', stateDir: directory, monitorEnabled: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}/?token=browser-test`;
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const first = await browser.newPage({ serviceWorkers: 'block' });
  await first.goto(new URL(url).origin);
  await first.locator('input[name="token"]').fill('browser-test');
  await first.locator('form button').click();
  await first.waitForFunction(() => !document.querySelector('#smart-esc').disabled);
  await first.click('#smart-settings');
  await first.uncheck('#smart-esc');
  await first.waitForFunction(() => !document.querySelector('#smart-esc').disabled);
  assert.equal(await first.isChecked('#smart-esc'), false);

  const second = await browser.newPage({ serviceWorkers: 'block' }); // Independent cookie/localStorage context.
  await second.goto(url);
  await second.waitForFunction(() => !document.querySelector('#smart-esc').disabled);
  assert.equal(await second.isChecked('#smart-esc'), false);
  await second.keyboard.press('Escape');
  assert.equal(await second.evaluate(() => window.stopCount), 0);
  console.log('PASS setting saved in one browser applies to a fresh browser');

  await first.check('#smart-esc');
  await first.waitForFunction(() => !document.querySelector('#smart-esc').disabled);
  await second.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await second.waitForFunction(() => document.querySelector('#smart-esc').checked);
  await second.keyboard.press('Escape');
  assert.equal(await second.evaluate(() => window.stopCount), 1);
  console.log('PASS existing browser refreshes shared setting and stops only once');

  await second.focus('#editor'); await second.keyboard.press('Escape');
  await second.evaluate(() => document.activeElement?.blur());
  await second.keyboard.press('Shift+Escape');
  await second.evaluate(() => document.body.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await second.keyboard.press('Escape');
  await second.evaluate(() => document.body.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await second.evaluate(() => {
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.textContent = 'Menu'; menu.tabIndex = 0;
    menu.addEventListener('keydown', () => menu.remove()); document.body.append(menu); menu.focus();
  });
  await second.keyboard.press('Escape');
  assert.equal(await second.evaluate(() => window.stopCount), 1, 'input, IME, chords and closing menus must not stop a turn');
  await second.click('#smart-settings'); await second.keyboard.press('Escape');
  assert.equal(await second.locator('#smart-dialog').isVisible(), false);
  assert.equal(await second.evaluate(() => window.stopCount), 1);
  await second.keyboard.down('Escape'); await second.keyboard.down('Escape'); await second.keyboard.up('Escape');
  assert.equal(await second.evaluate(() => window.stopCount), 2, 'key repeat must not cancel twice');
  console.log('PASS real keyboard events preserve input, IME, menus, dialogs and repeat guards');

  await first.route('**/_smart/api/settings', route => route.fulfill({ status: 503, body: '{}' }));
  await first.uncheck('#smart-esc');
  await first.waitForFunction(() => document.querySelector('#smart-settings-message').textContent.includes('戻しました'));
  assert.equal(await first.isChecked('#smart-esc'), true);
  console.log('PASS failed save restores acknowledged setting');

  const unavailable = await browser.newPage({ serviceWorkers: 'block' });
  await unavailable.route('**/_smart/api/status', route => route.fulfill({ status: 503, body: '{}' }));
  await unavailable.goto(url);
  await unavailable.waitForFunction(() => document.querySelector('#smart-settings-message').textContent.includes('取得できません'));
  assert.equal(await unavailable.isDisabled('#smart-esc'), true);
  await unavailable.keyboard.press('Escape');
  assert.equal(await unavailable.evaluate(() => window.stopCount), 0);
  console.log('PASS unknown startup settings prevent accidental Esc cancellation');
} finally {
  await browser?.close(); app?.close(); upstream.close();
  await rm(directory, { recursive: true, force: true });
}
