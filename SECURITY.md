# Security model

Smart ZCode is a **single-operator companion for a trusted coding-agent server**. It is not a sandbox, a multi-tenant service, or an audited public internet gateway.

## Boundaries

- The ZCode token grants the upstream agent's full Web capabilities, potentially including shell execution and access to files available to its OS account. There are no per-user roles. Anyone with this token is a trusted operator.
- Keep both ZCode and this proxy on loopback. Use Tailscale Serve HTTPS and restrict tailnet access to trusted devices. Do not use Funnel or bind publicly without a separate deployment security review.
- Set `SMART_PUBLIC_ORIGIN` to the exact phone URL. Mutations and WebSocket handshakes validate Origin; browsers additionally enforce the SameSite=Strict cookie. Non-browser clients possessing the token are not a separate untrusted role.
- The default login form uses POST. Legacy token query links still work but can appear in history or reverse-proxy logs. Never log query strings or cookies containing credentials.
- Authenticated proxied content is served with `Cache-Control: no-store`. Framing is denied. These measures do not prevent an upstream XSS or malicious trusted workspace content from acting with an already authenticated session.
- Proxy targets are fixed by server configuration. Push endpoints are restricted to supported Google, Mozilla and Apple HTTPS provider domains. Subscription keys are validated, and expired subscriptions are removed on 404/410.
- The service worker has no fetch/cache handler. Notification clicks always open/focus this origin; payload URLs are not used as navigation targets.

## Stored data and notification privacy

`.env` contains the upstream token. `.state/` contains VAPID private keys, Push endpoints/auth material, and shared settings. Newly created state directories use mode 0700 and files 0600. Restrict permissions on pre-existing directories, backups and any custom `SMART_STATE_DIR` as well. Do not commit state, environment overrides, browser profiles, logs or conversation screenshots.

Notification bodies can contain task titles, questions and choices. Push payloads are encrypted for the browser, but delivery services can observe metadata, and devices may display content on their lock screens. Only subscribe devices you control. Sensitive interaction bodies are omitted; this is not general-purpose redaction of all task text.

## Revoking access

Rotate the upstream ZCode token, update `.env`, and restart the wrapper to invalidate old HTTP/WebSocket logins. To revoke previously registered Push recipients too, stop the wrapper and remove `.state/subscriptions.json` (or the equivalent in your custom state directory) before restarting. Token rotation alone does not delete Push subscriptions. Already queued or displayed notifications cannot be recalled. Preserve the VAPID key unless you intentionally require all devices to re-enroll.

If the VAPID key is compromised, replace it and re-enroll devices: disable notifications in each installed app, remove the old private key/subscriptions while the server is stopped, restart, then enable notifications again.

## Reporting and verification

Do not post live tokens, Push endpoints, private keys, screenshots of private tasks, or exploit details in a public issue. Use the repository owner's private security-reporting channel when available; if none exists, request a private contact without publishing the sensitive material.

Run `npm test`, the browser checks, `npm audit`, and `node scripts/audit-history.mjs` before a release. The history script scans reachable/reflog blobs and commit messages for known local secrets and selected patterns; it is not a universal secret detector. Review Git author/committer identities, images, and every file intended for distribution manually. A clean scan does not establish the absence of unknown secrets or vulnerabilities.
