import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSettings } from '../src/settings.mjs';
import { createApp } from '../src/server.mjs';

test('Shared Esc settings persist across restart and serialize simultaneous writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createSettings(directory);
  assert.deepEqual(store.get(), { escStopEnabled: true, revision: 0 });
  const results = await Promise.all([store.update({ escStopEnabled: false }), store.update({ escStopEnabled: true }), store.update({ escStopEnabled: false })]);
  assert.deepEqual(results.map(r => r.revision), [1, 2, 3]);
  assert.deepEqual((await createSettings(directory)).get(), { escStopEnabled: false, revision: 3 });
  assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600);
  for (const invalid of [null, {}, [], { escStopEnabled: 'false' }, { escStopEnabled: true, extra: 1 }]) await assert.rejects(store.update(invalid));
  await rm(directory, { recursive: true });
  await assert.rejects(store.update({ escStopEnabled: true }));
  assert.equal(store.get().escStopEnabled, false, 'failed disk write must not change acknowledged settings');
  await mkdir(directory);
  await store.update({ escStopEnabled: true });
  assert.equal(JSON.parse(await readFile(join(directory, 'settings.json'))).revision, 4);
});

test('Settings API requires auth and same-origin JSON; all clients see persisted changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-settings-api-'));
  const app = await createApp({ upstream: 'http://127.0.0.1:9', token: 'settings-test', stateDir: directory, monitorEnabled: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.close(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Cookie: 'smart_zcode_token=settings-test', Origin: origin, 'X-Smart-ZCode': '1', 'Content-Type': 'application/json' };
  const post = (value, overrides = {}) => fetch(`${origin}/_smart/api/settings`, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(value) });
  assert.equal((await post({ escStopEnabled: false }, { Cookie: '' })).status, 401);
  assert.equal((await post({ escStopEnabled: false }, { Origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await post({ escStopEnabled: false }, { 'X-Smart-ZCode': '' })).status, 403);
  assert.equal((await post({ escStopEnabled: 'false' })).status, 400);
  const saved = await post({ escStopEnabled: false });
  assert.deepEqual((await saved.json()).settings, { escStopEnabled: false, revision: 1 });
  const anotherClient = await fetch(`${origin}/_smart/api/status`, { headers: { Cookie: headers.Cookie } });
  assert.deepEqual((await anotherClient.json()).settings, { escStopEnabled: false, revision: 1 });
  assert.equal((await createSettings(directory)).get().escStopEnabled, false);
});
