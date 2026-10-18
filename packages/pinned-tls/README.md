# Pinned TLS engine

検査済みIPへのTCP接続とは独立して、元のhostnameのSNI・証明書を検証するRustlsのWASM wrapper。YDR-060のconnectorを実装するための部品で、DNS・TCP・HTTP・購読・通知設定は扱わない。アプリのEvents providerはこの部品の追加では有効にならない。

`generated/tls.js` の `initSync({ module })` にWorkerへ同梱したWebAssembly.Moduleを渡す。リクエストごとに `new TlsClient(expectedHostname)` を作り、最後に `free()` する。`take_tls()` と `receive_tls()` は暗号文専用。`handshaking()` がfalseになる前の `write_application()` はデータをbufferせず拒否する。正常完了後だけ平文を渡し、16 KiBずつ書いて暗号文を排出する。受信feedは64 KiB以下に分割し、総量・期限・socketの中断は呼び出し側で制限する。

`peer_closed()`は認証済みTLS close_notifyを表し、生のTCP EOFとは区別する。close-delimited HTTPの正常完了にはこの値を使う。TLS解析の失敗後はこのgetterも拒否する。

Mozillaの公開trust anchorsだけを使い、独自CA・検証無効化・early data・session resumptionの公開APIを設けない。DNS名はSNIに入り、IP identityはIPの証明書検証を使う。TLS解析の失敗はそのclient内で保持し、後続の書き込みを拒否する。TLS認証の成功、HTTPの成功、通知の到達、利用者の既読はそれぞれ別の状態である。

## 再生成

生成環境はLinuxに統一する。Rust 1.99.1（wasm32-unknown-unknown target）、Zig 0.17.0、wasm-bindgen-cli 0.2.129、プロジェクトのNode、host用C linkerを使う。各公式配布のchecksumを確認する。Rustはrustupの既定構成、Zigとwasm-bindgenは公式配布でよい。既存の環境変数を変更する場合は、そのshellだけに限定する。

```sh
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export ZIG=/absolute/path/to/zig
export WASM_BINDGEN=/absolute/path/to/wasm-bindgen
node scripts/pinned-tls-build.ts
node scripts/pinned-tls-build.ts --check
npx vitest run tests/pinned-tls-engine.test.ts
```

WindowsではWSL内でLinux用の各toolを使って再生成する。PowerShell/Windowsでの生成はscriptが拒否する。crate sourceの絶対パスをremapし、debug情報を除去しても、panic位置の残るパス区切りはhost OSで異なるためである。通常のアプリ開発・unit testはWindowsのままでよく、Rust toolchainを必要としない。

ビルド用のRust/C compiler flagsと一時wrapperはscriptが設定する。`--check` は再生成した全ファイルをbyte単位で照合する。通常のunit testはmanifestの入力・出力hashを照合し、専用Linux CIがソースから再ビルドする。

Rustls、ring、webpki-roots等のバージョン・checksumはCargo.lockで固定する。root storeはOSの更新へ自動追従しないため、CA変更やsecurity advisoryの際はlockを更新し、再生成・CI照合・実Cloudflareの正例/負例を通して配備する。ライセンスは `generated/THIRD-PARTY-NOTICES.txt` に同梱する。

## 実環境の確認

`probe/` は公開badssl fixtureだけへHEADを送る。家庭データ・D1・Secrets・任意URLの入力は持たない。

```sh
node node_modules/wrangler/bin/wrangler.js dev --config packages/pinned-tls/probe/wrangler.jsonc --remote --ip 127.0.0.1 --port 8791
node scripts/pinned-tls-probe.ts http://127.0.0.1:8791
```

終了後はWranglerをCtrl-Cで停止する。対象IPは検証時の公開fixtureの値であり、変更された場合はDNSの全応答がpublicであることを確認してfixtureと記録を更新する。通常のunit/CIでは外部fixtureへ接続しない。

このTLS単体試験は5ケース（正例・証明書負例3件・close_notify）を確認する。任意のChatGPT callbackの到達性を証明せず、TCP側のCloudflare IP範囲等の制約も残る。

## HTTP connectorの実環境試験

`src/features/integration/notifications/worker-transport.mjs`は、DoHによるpublic IP検査からraw TCP・Rustls・上限付きHTTPまでを接続する。`worker-transport-loader.ts`が最初のPOSTで動的に読み込むため、Events無効時や通常ページ表示ではTLSを初期化しない。アプリ側の有効化条件は[YDR-069](../../docs/decisions/ydr-069-pinned-http-runtime.md)。preview/productionではproviderを設定せず、e2eだけで有効化する。

```sh
node node_modules/wrangler/bin/wrangler.js dev --config packages/pinned-tls/probe/http-wrangler.jsonc --remote --ip 127.0.0.1 --port 8792
node scripts/pinned-http-probe.ts http://127.0.0.1:8792
```

公開httpbin/badssl/Cloudflareだけを対象にする。11ケースで日本語本文・署名・秘密headerの除去、202受領、大きな本文のhead-only成功/本文読取り拒否、redirect拒否、証明書負例、private URL拒否、送信開始後の10秒timeoutを確認する。Cloudflare宛てはTCP拒否・アプリケーション送信未開始の対照試験で、実callbackの到達性を推定しない。D1・Secrets・任意callback入力は持たない。終了後はWranglerをCtrl-Cで停止する。

実測記録`probe/http-edge-result-2026-10-18.json`はsourceとWASM hashを保持し、`tests/notification-http-evidence.test.ts`で照合する。通信実装または生成物を変えた際は両probeの該当する実測を更新する。通常unit/CIでは公開fixtureへ接続しない。実callbackの購読・到達・解除・失効と定期取得の実行主体・遅延は引き続き#442で検証する。
