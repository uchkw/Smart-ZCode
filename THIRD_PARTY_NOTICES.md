# Third-party notices

The project license covers the original wrapper and artwork only. Installed dependencies retain their own licenses and copyright notices. No dependency source or upstream application bundle is vendored in this repository. Preserve the packages’ own LICENSE/NOTICE files when redistributing a bundle, container or installation.

## Functional reference and interoperability

- [Smart-DSH](https://github.com/hikarioyama/Smart-DSH), by hikarioyama and contributors, inspired mobile layout, Esc guards and notifications. Its `dsh-notify-push` and `dsh-esc-stop` package manifests declare MIT. Its DSH-specific plugin implementation, HMR patch and logos are not included here; the repository root does not supply a blanket license for every file.
- [ZCode](https://github.com/zai-org/ZCode), copyright 2026 Z.AI Co., Ltd, is separately installed under [Apache-2.0](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/LICENSE). This wrapper implements interoperability with its HTTP/WebSocket/V4 contracts. ZCode application source and official artwork are not distributed in this checkout. See its [NOTICE](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/NOTICE.md).
- The compact RPC implementation was written for this wrapper against the tagged serialization/framing contract used by ZCode (itself documenting the VS Code protocol). It does not bundle either project.
- `public/icon.svg` and its PNG renders are original geometry created for Smart ZCode. No external images or fonts were used.

## Locked npm dependency inventory

| Package | Version | License | Use |
| --- | --- | --- | --- |
| [agent-base](https://www.npmjs.com/package/agent-base/v/7.1.4) | 7.1.4 | MIT | Runtime |
| [asn1.js](https://www.npmjs.com/package/asn1.js/v/5.4.1) | 5.4.1 | MIT | Runtime |
| [bn.js](https://www.npmjs.com/package/bn.js/v/4.12.5) | 4.12.5 | MIT | Runtime |
| [buffer-equal-constant-time](https://www.npmjs.com/package/buffer-equal-constant-time/v/1.0.1) | 1.0.1 | BSD-3-Clause | Runtime |
| [debug](https://www.npmjs.com/package/debug/v/4.4.3) | 4.4.3 | MIT | Runtime |
| [ecdsa-sig-formatter](https://www.npmjs.com/package/ecdsa-sig-formatter/v/1.0.11) | 1.0.11 | Apache-2.0 | Runtime |
| [http_ece](https://www.npmjs.com/package/http_ece/v/1.2.0) | 1.2.0 | MIT | Runtime |
| [https-proxy-agent](https://www.npmjs.com/package/https-proxy-agent/v/7.0.6) | 7.0.6 | MIT | Runtime |
| [inherits](https://www.npmjs.com/package/inherits/v/2.0.4) | 2.0.4 | ISC | Runtime |
| [jwa](https://www.npmjs.com/package/jwa/v/2.0.1) | 2.0.1 | MIT | Runtime |
| [jws](https://www.npmjs.com/package/jws/v/4.0.1) | 4.0.1 | MIT | Runtime |
| [minimalistic-assert](https://www.npmjs.com/package/minimalistic-assert/v/1.0.1) | 1.0.1 | ISC | Runtime |
| [minimist](https://www.npmjs.com/package/minimist/v/1.2.8) | 1.2.8 | MIT | Runtime |
| [ms](https://www.npmjs.com/package/ms/v/2.1.3) | 2.1.3 | MIT | Runtime |
| [playwright](https://www.npmjs.com/package/playwright/v/1.63.0) | 1.63.0 | Apache-2.0 | Development |
| [playwright-core](https://www.npmjs.com/package/playwright-core/v/1.63.0) | 1.63.0 | Apache-2.0 | Development |
| [safe-buffer](https://www.npmjs.com/package/safe-buffer/v/5.2.1) | 5.2.1 | MIT | Runtime |
| [safer-buffer](https://www.npmjs.com/package/safer-buffer/v/2.1.2) | 2.1.2 | MIT | Runtime |
| [web-push](https://www.npmjs.com/package/web-push/v/3.6.7) | 3.6.7 | MPL-2.0 | Runtime |
| [ws](https://www.npmjs.com/package/ws/v/8.21.3) | 8.21.3 | MIT | Runtime |

In particular, **web-push 3.6.7 is MPL-2.0**, with source available from [web-push-libs/web-push, v3.6.7](https://github.com/web-push-libs/web-push/tree/v3.6.7) and the npm source package. It is used unmodified. MPL obligations apply to covered files; they do not relicense separate original wrapper files. If redistributing it in executable form, retain its notices and provide recipients access to the corresponding MPL-covered source. See the [MPL text](https://www.mozilla.org/MPL/2.0/) and [official FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

Playwright is a development dependency; browser binaries downloaded for testing are not shipped here and carry separate third-party notices. Review the inventory again after updating the lockfile.
