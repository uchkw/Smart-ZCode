# Official ZCode compatibility review

Reviewed on 2026-09-27.

| Item | Evidence |
| --- | --- |
| Official source | [zai-org/ZCode](https://github.com/zai-org/ZCode) |
| Official main / version | `29628c9acdb81b703bbd4080c207a0e7ce5e276e` / 3.14.3 |
| Source comparison | All 9 listed ZCode source paths matched the reference version in the checked environment |

The paths below belong to ZCode and contain the interfaces this wrapper uses. [Machine-readable comparison](upstream-comparison.json) records the reference version's Git object hashes and the results for those paths. A matching file hash means the file contents are identical; a matching directory tree hash covers its tracked contents recursively. These are **nine source paths, not nine runtime tests**, and they do not cover the entire ZCode application.

## Covered contracts

- `packages/server/src/http.ts`: static HTML, `/api/server-info`, token cookie and WebSocket upgrade.
- `packages/rpc/src`: 13-byte transport framing and tagged serialization.
- `packages/services/src/zcode-agent`: V4 hello/initialization, session index, conversation subscription and row-range methods.
- `packages/services/src/session/zcodeTaskService.ts`: task service contract.
- `packages/shared/src/zcode-protocol-v4`: wire frames, summaries, pending interactions and turn-header schemas.
- `packages/ui/src`: composer/stop/sidebar selectors and UI behavior.
- `packages/web/src`: Web client and connection setup.
- `packages/zcode-server-cli`: standalone server entry.
- `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4`: gateway, sessions-index publishing and conversation/turn projections.

The wrapper uses wire protocol 3 and the V4 sessions-index/conversation read APIs. It reads questions through a temporary `subscribeConversationV4` subscription, releases that subscription, and retrieves finished turns with `conversationRowsRangeV4`. It forwards browser traffic without translating application RPC writes.

The integer encoder matches upstream's signed 32-bit integer tag. Larger numbers use JSON, preserving timestamps and large values rather than truncating them.

## What this establishes

The source comparison supports compatibility with the HTTP/RPC interfaces and UI selectors in the reference version. HTTP/WebSocket, mobile browser and iPhone Push checks passed in a local development environment. A clean official release build was **not independently launched**. Source matches do not prove that every packaged release or configuration will behave identically; build options, installed runtimes and future updates can affect behavior.

The wrapper provides authenticated access to ZCode; it does not restrict ZCode's file access, command execution or data sent to model providers. Protocol compatibility is not a security guarantee. Review the [security model](../SECURITY.md) and official [NOTICE](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/NOTICE.md) for these boundaries.

## Check your own checkout

To compare a ZCode source checkout against the reference version above, fetch the official history into a disposable copy, then run:

```bash
git -C /path/to/disposable-ZCode fetch https://github.com/zai-org/ZCode.git main:refs/remotes/upstream/main
node scripts/check-upstream.mjs /path/to/disposable-ZCode 29628c9acdb81b703bbd4080c207a0e7ce5e276e HEAD
```

The script only reads Git objects and reports reference-version identifiers plus match results for your checkout. It fails when a listed path differs or is missing. Inspect any differences and run the live browser tests before claiming compatibility with another version.
