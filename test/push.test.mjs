import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { createPush, resolvePushSubject } from '../src/push.mjs';

test('VAPID uses the deployed HTTPS origin by default and rejects Apple-incompatible localhost subjects', () => {
  assert.equal(resolvePushSubject(undefined, 'https://phone.tailnet.ts.net'), 'https://phone.tailnet.ts.net');
  assert.equal(resolvePushSubject('mailto:admin@example.com', 'https://phone.tailnet.ts.net'), 'mailto:admin@example.com');
  assert.equal(resolvePushSubject(undefined, undefined), undefined);
  for (const subject of ['mailto:root@localhost', 'https://localhost', 'https://app.localhost', 'https://127.0.0.1', 'http://example.com']) assert.throws(() => resolvePushSubject(subject), /localhost is rejected/);
});

function device(id) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

test('Failed subscription persistence leaves memory unchanged and subsequent writes recover', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-push-persist-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const push = await createPush(directory, 'mailto:admin@example.com');
  const file = join(directory, 'subscriptions.json');
  await mkdir(file);
  const first = device('first'), second = device('second');
  await assert.rejects(push.subscribe(first));
  assert.equal(push.count(), 0);
  await rm(file, { recursive: true });
  await push.subscribe(first);
  await rm(file); await mkdir(file);
  await assert.rejects(push.unsubscribe(first.endpoint));
  assert.equal(push.count(), 1);
  await rm(file, { recursive: true });
  await Promise.all([push.subscribe(second), push.unsubscribe(first.endpoint)]);
  assert.equal(push.count(), 1);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [second]);
});

test('Push survives restart, encrypts payloads, and prunes expired devices without removing healthy ones', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-push-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const delivered = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, payload, options) => {
    // Exercise actual Web Push encryption and VAPID signing; no external recipient.
    const request = webpush.generateRequestDetails(subscription, payload, options);
    assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
    assert.match(request.headers.Authorization, /^vapid /);
    assert.ok(Buffer.isBuffer(request.body));
    assert.ok(!request.body.includes(Buffer.from('回答が必要です')));
    if (subscription.endpoint.endsWith('/expired')) throw Object.assign(Error('Gone'), { statusCode: 410 });
    if (subscription.endpoint.endsWith('/offline')) throw Object.assign(Error('Unavailable'), { statusCode: 503 });
    delivered.push(JSON.parse(payload));
  });
  const push = await createPush(directory, 'mailto:admin@example.com');
  const healthy = device('healthy'), expired = device('expired'), offline = device('offline');
  await Promise.all([push.subscribe(healthy), push.subscribe(expired), push.subscribe(offline)]);
  await push.subscribe(healthy); assert.equal(push.count(), 3);
  const restarted = await createPush(directory, 'mailto:admin@example.com');
  assert.equal(restarted.publicKey, push.publicKey); assert.equal(restarted.count(), 3);
  await restarted.notify({ title: '回答が必要です', body: '選択してください', tag: 'question-test' });
  assert.equal(delivered.length, 1); assert.equal(restarted.count(), 2);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'subscriptions.json'), 'utf8')).map(s => s.endpoint).sort(), [healthy.endpoint, offline.endpoint].sort());
  assert.equal((await stat(join(directory, 'vapid.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, 'subscriptions.json'))).mode & 0o777, 0o600);
  assert.equal(await restarted.test(healthy.endpoint), true);
  assert.equal(await restarted.test(offline.endpoint), false);
  await restarted.unsubscribe(healthy.endpoint);
  await assert.rejects(restarted.test(healthy.endpoint), /not subscribed/);
  assert.equal((await createPush(directory, 'mailto:admin@example.com')).count(), 1);
});
