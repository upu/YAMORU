---
type: Spike Report
title: Cloudflare edgeでの固定IPと元hostnameのTLS検証
description: native startTlsの失敗とRustls WASMによる正例・証明書負例の実測
tags: [yamoru, cloudflare, notifications, integration, tls]
status: stable
stale_after: 2026-11-18
---

# Cloudflare edgeでの固定IPと元hostnameのTLS検証

2026-10-18に、家庭データ・認証情報・D1 bindingを持たない一時remote previewで実施した。Wrangler 4.129.1、compatibility_date 2026-08-19、nodejs_compat/global_fetch_strictly_publicを使った。公開badssl fixtureのIPv4は104.154.89.105。fixtureのDNSとNode strict TLSの対照も確認した。本番YAMORUの配備・設定変更はない。

| 方式 | 接続先 | 期待hostname | 実Cloudflareの結果 |
|---|---|---|---|
| native startTls | hostname | badssl.com | HTTP 200 |
| native startTls | 固定IP | badssl.com | TLS Handshake Failed（2回） |
| native startTls | 固定IP | wrong.host.badssl.com | TLS Handshake Failed |
| Rustls WASM | 固定IP | badssl.com | HTTP 200 |
| Rustls WASM | 固定IP | wrong.host.badssl.com | 名前不一致で拒否、HTTP要求を渡さず |
| Rustls WASM | 固定IP | expired.badssl.com | 期限切れで拒否、HTTP要求を渡さず |
| Rustls WASM | 固定IP | self-signed.badssl.com | UnknownIssuerで拒否、HTTP要求を渡さず |
| Rustls WASM | 固定IP | badssl.com | HTTP 200と認証済みclose_notifyを確認 |

初期の試験用Rustls生成物ではlocal workerdでも同じ4ケースを確認した。同梱するLinux生成物の実Cloudflare確認は[実測記録](../../packages/pinned-tls/probe/edge-result-2026-10-18.json)にWASM hashと結果を保持し、unit testでもhash一致を確認する。Node strict TLSは正しいhostnameの証明書を検証し、wrong.hostの対照ではERR_TLS_CERT_ALTNAME_INVALIDになった。

nativeのSocket.openedは失敗する接続でもresolveしたため、TLS検証完了の証拠には使わない。write呼び出しを試みたこととwire上でHTTP要求が送られたことも区別する。ローカルではunsupported expectedServerHostnameのログが出た。upstream [workerd #6903](https://github.com/cloudflare/workerd/issues/6903)と整合するが、こちらの実験でpacket captureによるSNI欠落までは調べていない。

## 実装と再検証

- source・生成物・ライセンス: [packages/pinned-tls](../../packages/pinned-tls/README.md)
- 実行コード: [probe/worker.js](../../packages/pinned-tls/probe/worker.js)、[probe設定](../../packages/pinned-tls/probe/wrangler.jsonc)
- 正例・負例の検査: [pinned-tls-probe.ts](../../scripts/pinned-tls-probe.ts)
- オフラインのSNI・書き込み境界・生成物検査: [pinned-tls-engine.test.ts](../../tests/pinned-tls-engine.test.ts)
- source build: [pinned-tls-build.ts](../../scripts/pinned-tls-build.ts)、[専用CI](../../.github/workflows/pinned-tls.yml)

再実行はpackageのREADMEに従う。TLS部品を変更した場合は、その生成物でremote previewの5ケースを再実行する。試験用プロセスは検証後に終了する。

通常fetch＋事前DNS検査、独自の証明書検証、検証の無効化は採用しない。Rustls方式でもCloudflareのTCP接続先制約は残る。このTLS単体試験は実ChatGPT callbackを使用せず、実dotへの通知・解除・失効、HTTP応答の上限・中断・再試行を証明していない。TLSの採用範囲は[YDR-068](../decisions/ydr-068-pinned-tls-engine.md)、その後のHTTP connectorとWorkerへの接続は[YDR-069](../decisions/ydr-069-pinned-http-runtime.md)を参照し、#442は実接続の合格条件を満たすまで未完了とする。
