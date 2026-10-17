---
type: Decision
ydr_id: YDR-060
title: 通知の購読とcallbackの秘密を本人の接続に結び付けて保存する
description: 暗号化・有効期間・解除競合・実送信経路の検証境界を定める
tags: [yamoru, decisions, notifications, integration, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-060: 通知の購読とcallbackの秘密を本人の接続に結び付けて保存する

[#442](https://github.com/upu/YAMORU/issues/442)で[YDR-050](ydr-050-conversation-reminders.md)・[YDR-056](ydr-056-personal-notification-policy.md)・[YDR-059](ydr-059-durable-notification-outbox.md)を具体化する。共有予定や本人の通知設定は置き換えない。

## 保存と停止

本人・家庭・接続・認証済みclient・event名・正規化callback URL・canonical filterから購読IDを決める。Todo ruleまたは消耗品のfilterは保存するbatchでも家庭一致を確認する。接続ごとの有効購読は20件までとし、並列作成でも上限を維持する。

callback URLと24〜64 bytesの署名鍵をAES-GCMで一緒に暗号化する。AUTH_SECRETから用途を分けたHKDFで鍵を導出し、毎回新しい96 bit nonceと128 bit tagを使う。所有者・client・購読IDを追加認証データとし、別の所有者や購読への暗号文移動を拒否する。AUTH_SECRETの変更後に古い暗号文を復号できない場合は送信せず、再購読を要する。

更新にはrevision照合を要する。未保存の購読への解除にもtombstoneを残し、確認中だった古い要求で復活しない。解除・失効で暗号文と鍵fingerprintを消し、停止済みmetadataは90日後から一回100件ずつ削除する。家庭・本人・接続の物理削除は複合FKでcascadeする。

## 有効期間と検証

有効期間は既定・上限24時間、最小1分、かつ接続grantの期限以下とする。ttlMsの有限指定を上限内で尊重し、nullでも無期限を付与しない。callbackの確認は本人・接続・URL・鍵fingerprint・providerが同じ成功だけを最大15分cacheする。最終batchでも確認の鮮度とgrantを確かめる。

新しい鍵には新しいchallengeを要し、鍵更新後の5分間だけ前の鍵も暗号文内に保持して二つのStandard Webhooks署名を付けられる。期限後は現行鍵だけで署名する。検証の応答は4 KiBまで、接続・本文を含む期限は10秒とし、要求中断で購読を保存しない。

URLはHTTPSの443だけとし、接続ごとにDNSの全応答を検査する。public以外やredirectは拒否し、検証済みIPへ接続しながら元hostのTLS証明書とSNIを維持するconnectorを必須とする。通常のfetchへ事前DNS検査だけを足したものでは代用しない。

## 配備と実証

0041は購読表と索引の追加だけで、既存ID・日時・outbox・旧WorkerのSQLを変更しない。

| 状態 | 読み書きと互換性 |
|---|---|
| 現Worker / 現schema | 既存操作を継続 |
| 現Worker / 0041追加後 | 新表を無視して既存操作を継続 |
| 新Worker / 0041追加後 | 購読を保存し、既存操作とoutboxを保持。旧Workerへ戻しても購読行を保持 |
| contract後 | 置換する旧構造はなくcontract不要 |

送信providerをruntimeで設定しない間はEventsを公開しない。ローカルのmockでの署名・購読成功は、実connectorのTLS動作やdotへの到達を証明しない。実送信・複数購読先の結果保存・非対応時の定期取得・実dotの到達と解除は、#442の残る合格条件として扱う。

参照: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)、[MCP Events draft](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md)（2026-10-18確認）。ChatGPTのcallback errorはOpenAI文書に合わせて-32015を使う。
