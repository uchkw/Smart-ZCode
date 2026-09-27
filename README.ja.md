# Smart ZCode

[English](README.md) · [セキュリティ](SECURITY.md) · [互換性の確認結果](docs/compatibility.md)

<img src="public/icon-192.png" alt="Smart ZCode 蛍光グリーンのSと白いZのオリジナルアイコン" width="96" height="96">

**[ZCode --web](https://github.com/zai-org/ZCode)** をスマートフォンから使うためのラッパーです。全幅チャット、バックグラウンドPush通知、端末間で共有するEsc停止設定を備えています。認証付きHTTP/WebSocketプロキシとして動作し、既存ZCodeの変更は不要です。

**このOSSは、hikarioyama氏の [Smart-DSH](https://github.com/hikarioyama/Smart-DSH) にインスパイアされています。** 特に、スマートフォン向けUI、通知、Escキーによる停止操作を参考にしています。

Z.AIやDeepSeekとは無関係の非公式プロジェクトです。接続すると、上流のコーディングエージェントが持つファイル操作・コマンド実行機能も利用できます。信頼できる個人環境で、プライベートネットワークとHTTPSを使用してください。

## 主な機能

- **スマホUI**: 767px以下ではチャットと入力欄を全幅表示。左上ボタンからセッション一覧を直接開きます。safe areaと可視領域の高さに追従します。
- **バックグラウンド通知**: 質問・承認待ち、親ターンの終了・停止・エラーを通知します。ブラウザを閉じてもサーバーがV4を購読します。短いターンと再接続中の終了は履歴で補完し、子セッションは除外します。
- **端末ごとの通知設定**: ON/OFF、テスト送信、既存購読の起動時復元。通知許可は有効化ボタンを押したときだけ要求します。非公開指定の質問本文は送信しません。
- **共有Esc設定**: サーバーに永続保存。IME変換、修飾キー、リピート、入力欄、メニュー、ダイアログ中の誤停止を抑止します。
- **PWA**: ホーム画面登録、オリジナルアイコン、通知からのフォーカス。Service Workerは会話や認証済みレスポンスをキャッシュしません。
- **token認証**: フォームはPOSTで送信。以降はHttpOnly・SameSite=Strict Cookieを使い、設定したHTTPS originではSecure属性を付けます。HTTP・WebSocket・通知APIは認証必須です。

## 必要環境と互換性

Node.js **22.9以上**（24.18で検証）と、token認証付きで起動済みの `zcode --web` が必要です。内部RPCとUIセレクターに依存するため、すべての将来バージョンへの互換性を保証するものではありません。

対象はZCode **3.14.3**（参照commit [`29628c9`](https://github.com/zai-org/ZCode/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e)）です。ラッパーが使用するHTTP/RPCのインターフェースとUIセレクターを、このバージョンのソースと照合しています。動作試験とiPhoneへのPush受信確認はローカルの開発環境で実施しました。公式リリースを別途クリーンビルドして起動した試験は行っていません。[利用するインターフェースと検証範囲](docs/compatibility.md)をご覧ください。

**ラッパーは、ZCodeのファイルアクセス・コマンド実行・モデル提供元へのデータ送信を制限しません。** [セキュリティ文書](SECURITY.md)をご確認ください。

## 起動

ZCode Webを起動し、アクセストークンを控えます。このリポジトリで次を実行してください。

```bash
npm ci
cp .env.example .env
chmod 600 .env
# .env の ZCODE_URL と ZCODE_TOKEN を編集
npm start
```

[http://127.0.0.1:33114/](http://127.0.0.1:33114/) を開いてtokenを入力します。スマホ自身の `127.0.0.1` はサーバーには接続しません。スマホからは次節のHTTPS URLを使用します。

| 環境変数 | 既定値・意味 |
| --- | --- |
| `ZCODE_URL` | `http://127.0.0.1:33113/`。信頼できる上流のみを指定 |
| `ZCODE_TOKEN` | 必須。既存ZCodeのtoken |
| `SMART_HOST` | `127.0.0.1` |
| `SMART_PORT` | `33114` |
| `SMART_PUBLIC_ORIGIN` | スマホから利用するHTTPS origin。Origin検証にも使用 |
| `SMART_STATE_DIR` | `.state`。VAPID鍵・端末購読・共有設定 |
| `VAPID_SUBJECT` | 未指定なら `SMART_PUBLIC_ORIGIN`。明示する場合は実在の `mailto:` 連絡先またはHTTPS URL |

`.env`、テンプレート以外の `.env.*`、`.state/`、ログ、スクリーンショットはGit対象外です。独自の状態保存先を指定する場合は、そのディレクトリも公開せず保護してください。ZCodeのtoken変更時は `.env` を更新してラッパーを再起動します。購読を維持するため `.state/vapid.json` を保存してください。

互換性のため `?token=...` も受け付け、すぐ `/` へ移動します。ただしブラウザ・プロキシの履歴に残る可能性があるため、フォームを推奨します。token付きURLは共有・コミットしないでください。

## Tailscale HTTPSでスマホから接続

既存のServe設定を確認してからホストで実行します。

```bash
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:33114
tailscale serve status
```

権限不足の場合は、同じ設定コマンドをホストのターミナルから `sudo` で実行します。公開先は**同じtailnet内**であり、インターネット向けFunnelは不要です。tailnetの接続許可も信頼する端末に限定してください。

`.env` に `SMART_PUBLIC_ORIGIN=https://your-machine.your-tailnet.ts.net` を設定し、ラッパーを再起動します。以降はそのHTTPS URLを使用します。書き込みAPIとWebSocketは別originを拒否します。ZCodeとラッパーの待受はloopbackのままにしてください。

1. スマホを同じtailnetへ接続し、HTTPS URLを開きます。
2. ZCodeのtokenでログインします。
3. iPhone/iPadは「ホーム画面に追加」して、そのアプリから開きます。AndroidはWeb Push対応ブラウザを使用します。
4. 右上の通知設定から有効化し、ブラウザの通知を許可して「テスト通知」を送ります。

Appleは `mailto:root@localhost` などの送信者情報を `403 BadJwtToken` で拒否します。実際のHTTPS originまたは連絡先を使用してください。送信者情報だけの修正なら鍵・購読の再作成は不要です。

登録済みのホーム画面アイコンはOSに古い画像が残る場合があります。更新されなければホーム画面へ追加し直してください。正式採用したアイコンは蛍光グリーンのSと白いZを組み合わせたオリジナルのSVG図形で、ZCode・DeepSeekのロゴ、外部画像、フォントを使用していません。

## 常駐起動

Linuxユーザーsystemdのテンプレートは [scripts/smart-zcode.service](scripts/smart-zcode.service) です。`WorkingDirectory`、`EnvironmentFile`、`ExecStart`のNode絶対パスを環境に合わせて変更します。

```bash
mkdir -p ~/.config/systemd/user
cp scripts/smart-zcode.service ~/.config/systemd/user/
# インストール先と `command -v node` を確認して編集
systemctl --user daemon-reload
systemctl --user enable --now smart-zcode.service
journalctl --user -u smart-zcode.service -f
```

同じポートの手動起動プロセスは先に停止します。ZCode自体は別サービスです。ログアウト後の常駐にはホストのlinger設定が必要な場合があります。一時的な `systemd-run` サービスはOS再起動後に復元されません。必要ならテンプレートをインストールしてください。

## 検証と保守

```bash
npm test
npx playwright install chromium
npm run test:browser
npm run test:settings-browser
npm run test:push-browser
node scripts/audit-history.mjs
npm audit
```

- 自動テストは一時ディレクトリと模擬ZCodeを使用し、認証、Origin制限、binary WebSocket、分割フレーム、質問本文、ターン履歴、Push暗号化、失効端末除外を検証します。
- `test:browser` は稼働中のZCodeを読み取ります。接続先は `SMART_TEST_URL` → `SMART_PUBLIC_ORIGIN` → loopbackの順です。360/390/412/767/768/1280pxの画面、セッション閲覧、入力欄、Esc、HTTPS Cookie、Service Workerを検証します。実タスクへの送信・停止はしません。`artifacts/` の画像には会話内容が写るため公開しないでください。
- 設定・Pushのブラウザテストは隔離した模擬環境です。viewport変更はすべてのiOS実キーボードの確認を代替しません。iPhoneへの実Push受信は別途確認しました。
- SVG編集後のPNG生成は `node scripts/build-icons.mjs` です。

運用上の境界、通知のプライバシー、アクセス失効手順は[セキュリティ文書](SECURITY.md)、依存関係のライセンスは[第三者のライセンス・帰属](THIRD_PARTY_NOTICES.md)をご覧ください。新しいコミットも公開前に確認してください。スキャンで未検出でも、あらゆる秘密情報の不在を保証するものではありません。

## 動作範囲・差分

監視対象は `/api/server-info` にあるワークスペースです。ラッパーの新規起動時には、それ以前の履歴を大量通知しないため基準時刻を設定します。同じプロセス内の再接続では未通知の終了と質問を復元します。Push配信失敗は記録しますが、永続的な配信キュー・到達保証はありません。

質問本文は一時的なV4購読から読み、直後に解除します。取得失敗時はタスク名で通知し、既に回答済みなら通知しません。通知にはタスク名・質問文が含まれ、ロック画面にも表示され得ます。通知タップはアプリを開く・フォーカスする動作で、個別タスクへの移動ではありません。

V4ターン履歴の終了状態は成功・中断・失敗の3種類です。Smart-DSHにあるtoken上限・blockedの細分類は、このAPIから取得できません。終了通知は依頼の成功を独立検証した意味ではありません。共有Esc設定は設定画面を開いた時、タブ復帰時、表示中の15秒ごとの確認で反映します。

DSH固有の共有HMR修正は対象外です。本ラッパーは信頼する利用者向けで、複数ユーザーの権限分離、セキュリティサンドボックス、インターネット公開用サービスではありません。

## ライセンス

独自コード・文書・アイコンは [MIT](LICENSE)。依存関係には別のライセンスがあり、`web-push` はMPL-2.0です。[第三者のライセンス・帰属](THIRD_PARTY_NOTICES.md)をご覧ください。別途導入するZCodeには作者のライセンスが適用されます。名称は互換性の説明用で、公式の承認を意味しません。
