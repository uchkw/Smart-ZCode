# Smart ZCode

[日本語](README.ja.md) · [Security](SECURITY.md) · [Compatibility review](docs/compatibility.md)

<img src="public/icon-192.png" alt="Smart ZCode's original neon-green S and white Z icon" width="96" height="96">

A smartphone companion for **[ZCode --web](https://github.com/zai-org/ZCode)**: full-width chat, background Web Push notifications, and a shared Esc-to-stop setting. Implemented as a standalone authenticated HTTP/WebSocket proxy. No modifications to your ZCode installation are required.

**This open-source project is inspired by [Smart-DSH](https://github.com/hikarioyama/Smart-DSH) by hikarioyama**, particularly its mobile interface, notifications, and Esc-to-stop controls.

Unofficial project; not affiliated with Z.AI or DeepSeek. This wrapper provides access to the underlying coding agent, including its filesystem and command-execution capabilities. Use it for a trusted personal environment behind a private network and HTTPS.

## Features

- **Phone layout:** full-width conversation and composer below 768px; the top-left button opens the session list directly. Safe-area and visible-viewport sizing accommodate mobile keyboards.
- **Background notifications:** questions, permission requests, and root-turn completion, interruption, or failure. A server-side V4 subscriber keeps monitoring when browsers are closed. Turn history recovers short turns and same-process reconnect gaps; subagents are excluded.
- **Per-device Push controls:** enable, disable, and test. Existing subscriptions are restored without prompting on page load. Sensitive interaction bodies are omitted.
- **Shared Esc setting:** persisted on the server, shared across devices. IME composition, modifiers, repeat presses, inputs, menus and dialogs retain their own Escape behavior.
- **PWA:** standalone installation, original icons, notification-click focus. No chat or authenticated-response cache is implemented by the service worker.
- **Token authentication:** the login form submits the token by POST, then uses an HttpOnly, SameSite=Strict cookie; Secure on the configured HTTPS origin. HTTP, WebSocket and notification APIs require authentication.

## Requirements and compatibility

Node.js **22.9+**; tested with Node 24.18. An existing token-protected `zcode --web` server is required. The wrapper uses internal ZCode RPC contracts and UI selectors, so it is **version-specific**, not a promise of compatibility with every future release.

Targets ZCode **3.14.3**, reference commit [`29628c9`](https://github.com/zai-org/ZCode/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e). The HTTP/RPC interfaces and UI selectors used by the wrapper were checked against this version. Runtime and iPhone Push checks were performed in a local development environment; a clean official release build was not independently launched. See the [supported interfaces and verification limits](docs/compatibility.md).

The wrapper does **not** restrict ZCode’s file access, command execution or data sent to model providers. See the [security model](SECURITY.md).

## Quick start

Start your existing ZCode Web server and retain its access token. In this checkout:

```bash
npm ci
cp .env.example .env
chmod 600 .env
# Edit ZCODE_URL and ZCODE_TOKEN in .env.
npm start
```

Open [http://127.0.0.1:33114/](http://127.0.0.1:33114/) and enter the ZCode token. `127.0.0.1` on your phone refers to the phone itself; use the HTTPS setup below for remote access.

| Variable | Default / purpose |
| --- | --- |
| `ZCODE_URL` | `http://127.0.0.1:33113/`; trusted upstream only |
| `ZCODE_TOKEN` | Required; existing ZCode access token |
| `SMART_HOST` | `127.0.0.1` |
| `SMART_PORT` | `33114` |
| `SMART_PUBLIC_ORIGIN` | HTTPS origin used by the phone; also enforces exact Origin matching |
| `SMART_STATE_DIR` | `.state`; private VAPID keys, subscriptions and shared settings |
| `VAPID_SUBJECT` | Defaults to `SMART_PUBLIC_ORIGIN`; optionally your real `mailto:` contact or HTTPS URL |

`.env`, `.env.*` (except the template), `.state/`, logs and screenshots are Git-ignored. Protect any custom state directory yourself and keep it outside source control. If ZCode rotates its token, update `.env` and restart this wrapper. Keep `.state/vapid.json` across restarts to preserve subscriptions.

Legacy `?token=...` links remain supported and immediately redirect to `/`, but may leave the token in browser/proxy history. Prefer the login form and never share or commit a token URL.

## Phone access with Tailscale HTTPS

Run on the host, after checking for existing Serve configuration:

```bash
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:33114
tailscale serve status
```

If Serve requires administrator privileges, run the same configuration command with `sudo` in your terminal. This exposes the wrapper to your **tailnet**, not the public internet; Funnel is unnecessary. Restrict tailnet access to trusted devices.

Set `SMART_PUBLIC_ORIGIN=https://your-machine.your-tailnet.ts.net` in `.env` and restart the wrapper. Use that HTTPS URL thereafter: mutation APIs and WebSockets reject other origins. Keep the upstream and wrapper bound to loopback.

1. Connect the phone to the same tailnet and open your HTTPS URL.
2. Sign in with the ZCode token.
3. On iPhone/iPad, **Add to Home Screen**, then launch that installed app. On Android, use a browser supporting Web Push.
4. Open the notification settings button, enable notifications, allow the browser prompt, and send a test notification.

Apple rejects localhost VAPID identities such as `mailto:root@localhost` with `403 BadJwtToken`. Use the actual public origin or a real contact address. Changing the contact identity does not require changing the VAPID keys or re-registering devices.

Existing home-screen installations may retain an older icon until re-added. The adopted icon combines a neon-green S and a white Z using original SVG geometry; no ZCode or DeepSeek logo, stock image, or external font is included.

## Persistent service

Use [scripts/smart-zcode.service](scripts/smart-zcode.service) for Linux user systemd. Adjust `WorkingDirectory`, `EnvironmentFile` and the absolute Node path in `ExecStart` before installing:

```bash
mkdir -p ~/.config/systemd/user
cp scripts/smart-zcode.service ~/.config/systemd/user/
# Edit the installed file for your paths and `command -v node`.
systemctl --user daemon-reload
systemctl --user enable --now smart-zcode.service
journalctl --user -u smart-zcode.service -f
```

Stop any manual wrapper process on the same port first. ZCode is a separate service. Login persistence may require your host's user-linger configuration. A transient `systemd-run` service does not survive a host reboot; install the template if you need that behavior.

## Verification and maintenance

```bash
npm test
npx playwright install chromium
npm run test:browser
npm run test:settings-browser
npm run test:push-browser
node scripts/audit-history.mjs
npm audit
```

- Unit/integration tests use temporary state and mock ZCode services. Coverage includes auth, Origin checks, binary WebSocket relay, fragmented frames, V4 question snapshots, turn-history recovery, encrypted Push construction and expired-subscription pruning.
- `test:browser` reads an existing ZCode instance, using `SMART_TEST_URL`, then `SMART_PUBLIC_ORIGIN`, then loopback. It checks widths 360/390/412/767/768/1280, sessions and composer layout, Esc guards, HTTPS cookies and service-worker readiness. It does not send prompts or stop real turns. Screenshots in `artifacts/` may contain private conversation data; do not publish them.
- The settings and Push browser suites use isolated fixtures, not real devices or live tasks. Physical keyboard behavior on every iOS version is not established by viewport emulation. iPhone Push delivery was separately confirmed in the deployment test.
- Rebuild PNG icons with `node scripts/build-icons.mjs` after editing `public/icon.svg`.

See [the security model](SECURITY.md) for deployment boundaries, notification privacy and access revocation, and [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses. Review new commits before publishing; a clean scan is not a guarantee that all possible secrets are absent.

## Behavior and limits

Only workspaces listed by `/api/server-info` are monitored. New wrapper processes establish a fresh notification baseline rather than replaying all old work. Same-process reconnects recover unseen turn endings and pending questions. Provider delivery failures are logged; there is no durable Push delivery queue or guaranteed delivery.

Question text comes from a temporary V4 conversation subscription that is released after reading. If the snapshot is unavailable, the task title is used; if the question is already answered, it is skipped. Notifications may disclose task/question text on a lock screen. Tapping focuses or opens the app, without task deep-linking.

ZCode's V4 turn headers expose success/interruption/failure, so notifications use those three categories. Smart-DSH's token-cap/blocked subcategories are not exposed by this contract. Turn termination is not independent verification that a requested job succeeded. Shared Esc changes propagate when settings open, the tab becomes visible, or the visible tab's 15-second status poll runs.

The DSH-specific shared-HMR patch is not applicable to ZCode and is not included. This is a trusted single-operator proxy, not a multi-user authorization system, security sandbox, or public internet service.

## License and credits

Original wrapper code, documentation and artwork: [MIT](LICENSE). Dependency licenses remain separate; notably `web-push` is MPL-2.0. See [third-party notices](THIRD_PARTY_NOTICES.md). ZCode is separately installed and licensed by its authors. The project name describes interoperability and does not imply endorsement.
