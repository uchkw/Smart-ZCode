import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

process.loadEnvFile('.env');
const origin = process.env.SMART_TEST_URL || process.env.SMART_PUBLIC_ORIGIN || `http://127.0.0.1:${process.env.SMART_PORT || 33114}`;
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const width of (process.env.SMART_TEST_WIDTHS || '360,390,412,767,768,1280').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 });
    context.setDefaultTimeout(15000);
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.locator('input[name="token"]').fill(process.env.ZCODE_TOKEN);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('form button').click({ noWaitAfter: true }),
    ]);
    await page.locator('[data-testid="v4-composer"]').waitFor();
    assert.equal(new URL(page.url()).searchParams.has('token'), false);
    // A new document opened from the address bar/bookmark sends Fetch-Site:none.
    await page.goto('about:blank');
    const reopened = await page.goto(new URL(origin).origin);
    assert.equal(reopened.status(), 200);
    await page.locator('[data-testid="v4-composer"]').waitFor();
    if (new URL(origin).protocol === 'https:') {
      const session = (await context.cookies(origin)).find(cookie => cookie.name === 'smart_zcode_token');
      assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Strict');
      assert.equal(await page.evaluate(() => isSecureContext), true);
      await page.evaluate(() => navigator.serviceWorker.ready);
    }
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
    if (width < 768) {
      assert.equal(await page.locator('[data-workspace-sidebar-panel]').isVisible(), false);
      await page.click('#smart-menu'); await page.locator('[data-testid="sidebar"]').waitFor();
      await page.waitForTimeout(350);
      assert.ok((await page.locator('[data-workspace-sidebar-panel]').boundingBox()).width <= width);
      const tasks = page.locator('[data-testid^="task-item-"]');
      if (await tasks.count()) {
        await tasks.first().click();
        await page.waitForTimeout(700);
        assert.equal(await page.locator('[data-workspace-sidebar-panel]').isVisible(), false);
        const box = await page.locator('[data-testid="v4-composer"]').boundingBox();
        assert.ok(box.y + box.height <= 844, `Composer clipped at ${width}: ${JSON.stringify(box)}`);
        assert.ok(box.width > width * .85);
      } else await page.click('#smart-menu');
      if (width === 390) await page.screenshot({ path: 'artifacts/mobile-chat.png' });
      // Approximate viewport contraction; real iOS keyboard still requires a device check.
      await page.setViewportSize({ width, height: 520 }); await page.waitForTimeout(200);
      const compact = await page.locator('[data-testid="v4-composer"]').boundingBox();
      assert.ok(compact.y + compact.height <= 520, `Keyboard viewport clipped at ${width}`);
      await page.setViewportSize({ width, height: 844 });
    } else assert.equal(await page.locator('#smart-menu').isVisible(), false);
    await page.click('#smart-settings'); assert.equal(await page.locator('#smart-dialog').isVisible(), true);
    if (width === 390) await page.screenshot({ path: 'artifacts/mobile-settings.png' });
    await page.click('#smart-close');
    assert.deepEqual(errors, []);
    console.log(`PASS live UI ${width}px`); await context.close();
  }
  // The shipped Esc listener is exercised with harmless DOM buttons, no live task.
  const page = await browser.newPage();
  let fixtureSettings = { escStopEnabled: true, revision: 0 };
  await page.route('http://smart.test/**', route => {
    const request = route.request();
    if (request.url().includes('/_smart/api/')) {
      if (request.method() === 'POST') fixtureSettings = { ...request.postDataJSON(), revision: fixtureSettings.revision + 1 };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connected: true, settings: fixtureSettings }) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><button data-testid="v4-stop">Stop</button><input id="editor"></body></html>' });
  });
  await page.goto('http://smart.test');
  await page.addScriptTag({ content: await readFile('public/mobile.js', 'utf8') });
  await page.waitForFunction(() => !document.querySelector('#smart-esc').disabled);
  const result = await page.evaluate(async () => {
    let clicks = 0; document.querySelector('[data-testid="v4-stop"]').onclick = () => clicks++;
    // Model the existing upstream window listener to catch duplicate/unguarded stops.
    window.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) clicks++; });
    const send = async (target = document.body, extra = {}) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...extra })); await Promise.resolve(); };
    await send(); const normal = clicks;
    await send(document.body, { repeat: true }); await send(document.body, { ctrlKey: true }); await send(document.body, { isComposing: true }); await send(document.querySelector('#editor'));
    document.querySelector('#smart-esc').checked = false; document.querySelector('#smart-esc').dispatchEvent(new Event('change')); await send();
    const guarded = clicks;
    while (document.querySelector('#smart-esc').disabled) await new Promise(resolve => setTimeout(resolve, 10));
    document.querySelector('#smart-esc').checked = true; document.querySelector('#smart-esc').dispatchEvent(new Event('change'));
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.textContent = 'Menu'; document.body.append(menu); await send(); menu.remove();
    return { normal, guarded, final: clicks };
  });
  assert.deepEqual(result, { normal: 1, guarded: 1, final: 1 }); console.log('PASS Esc guards and upstream duplicate prevention');
} finally { await browser.close(); }
