import webpush from 'web-push';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function resolvePushSubject(subject, publicOrigin) {
  const value = subject || publicOrigin;
  if (!value) return undefined;
  const uri = new URL(value);
  const host = (uri.protocol === 'mailto:' ? uri.pathname.split('@').at(-1) : uri.hostname).toLowerCase();
  if (!['https:', 'mailto:'].includes(uri.protocol) || !host.includes('.') || host.endsWith('.localhost') || host === '127.0.0.1') {
    throw Error('VAPID_SUBJECT must use a real HTTPS URL or mailto address; localhost is rejected by Apple Push');
  }
  return value;
}

export async function savePrivate(file, data) {
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export function validateSubscription(subscription) {
  const url = new URL(subscription?.endpoint);
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw Error('Unsupported push endpoint');
  if (!/^[\w-]+={0,2}$/.test(subscription.keys?.p256dh || '') || Buffer.from(subscription.keys.p256dh, 'base64url').length !== 65 || Buffer.from(subscription.keys?.auth || '', 'base64url').length !== 16) throw Error('Invalid push keys');
  return { endpoint: url.href, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
}
export async function createPush(directory, subject) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(directory, name), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return fallback; } };
  let keys = await read('vapid.json', null);
  if (!keys) { keys = webpush.generateVAPIDKeys(); await savePrivate(join(directory, 'vapid.json'), keys); }
  let subscriptions = await read('subscriptions.json', []);
  let writes = Promise.resolve();
  const mutate = transform => {
    writes = writes.catch(() => {}).then(async () => {
      const next = transform(subscriptions);
      await savePrivate(join(directory, 'subscriptions.json'), next);
      subscriptions = next;
    });
    return writes;
  };
  const send = async (subscription, payload) => {
    try {
      if (!subject) throw Error('Set VAPID_SUBJECT or SMART_PUBLIC_ORIGIN before enabling Push');
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, timeout: 10000, vapidDetails: { subject, ...keys } });
      return true;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await mutate(items => items.filter(s => s.endpoint !== subscription.endpoint));
      let reason;
      try { reason = JSON.parse(error.body).reason; } catch { /* Provider may return plain text. */ }
      // Log only a provider reason code, never the endpoint, keys or raw response.
      const safeReason = typeof reason === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(reason) ? reason : '';
      console.warn('[push] Delivery failed:', error.statusCode || error.code || 'configuration/network error', safeReason);
      return false;
    }
  };
  return {
    publicKey: keys.publicKey,
    count: () => subscriptions.length,
    async subscribe(value) {
      const s = validateSubscription(value);
      await mutate(items => {
        if (items.length >= 100 && !items.some(x => x.endpoint === s.endpoint)) throw Error('Subscription limit');
        return [...items.filter(x => x.endpoint !== s.endpoint), s];
      });
    },
    async unsubscribe(endpoint) { await mutate(items => items.filter(s => s.endpoint !== endpoint)); },
    async test(endpoint) { const s = subscriptions.find(s => s.endpoint === endpoint); if (!s) throw Error('Device not subscribed'); return send(s, { title: 'Smart ZCode', body: '通知の準備ができました。', tag: 'smart-test', url: '/' }); },
    async notify(payload) { await Promise.allSettled(subscriptions.map(s => send(s, payload))); },
  };
}
