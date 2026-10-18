---
type: Decision
ydr_id: YDR-068
title: 検査済みIPへのTLS検証にソースから生成したRustlsを使う
description: native startTlsのedge制約を回避し、証明書検証前の業務データ送信を禁止する
tags: [yamoru, decisions, notifications, integration, cloudflare]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-068: 検査済みIPへのTLS検証にソースから生成したRustlsを使う

YDR-060の「検証済みIPへ接続しながら元hostのTLS証明書とSNIを維持する」を実装する部品として、RustlsとringのWASMを使う。YDR-060のpublic IP検査、redirect拒否、期限・本文上限、runtimeの有効化条件を変更しない。

## 根拠

[実験](../spikes/pinned-tls.md)ではnative `startTls({ expectedServerHostname })` のhostname接続は実Cloudflareで成功したが、固定IPへの接続は正しいhostnameでも失敗した。Rustlsをraw TCPから独立して使う方式では、同じ固定IPに対して正例が成功し、hostname不一致・期限切れ・自己署名の負例を拒否した。これを全callbackの到達性や実dotの通知成功とは扱わない。

## 境界

`packages/pinned-tls/` にRust source、Cargo.lock、固定toolchain、生成WASM・JS・型宣言・第三者ライセンスを保持する。残るpanic位置のパス区切りのOS差を避け、生成元はLinuxに統一する。Windows開発時の再生成はWSLで行う。専用CIは固定版から再生成してbyte単位で照合し、通常のunit testもsource/生成物のhashと実際のClientHelloを検査する。

Mozilla由来のwebpki-rootsを使い、hostname・有効期間・信頼chainの検証を無効にするAPIを設けない。early dataとsession resumptionを無効にする。Rustlsのhandshake完了前はアプリケーションの平文を受け付けず、TLS解析・書き込み失敗後は同じclientを再利用しない。呼び出し側はリクエストごとにclientを作り、暗号文・平文の上限、socketの中断、最後の解放を担当する。

root storeはOSの更新へ自動追従しない。CAやsecurity advisoryへの対応は固定依存更新→source build→生成物照合→実Cloudflareの正例・負例→配備の順に行う。RustlsはHTTP parser、DNS resolver、到達・既読・業務完了の判定を代行しない。

## 有効化

この部品の追加ではEvents providerを有効にしない。HTTP connectorの接続後、実callbackの購読・到達・解除・失効を確認する。定期取得側の追加scope・実行主体・実測遅延も#442の別の検証項目であり、TLS単体試験で代用しない。スキーマ・既存購読・通知設定・家庭の業務データの変更はない。
