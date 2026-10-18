---
type: Decision
ydr_id: YDR-069
title: 検査済みIPのHTTP送信を明示設定されたWorkerで使う
description: Rustlsの通信・HTTP上限・中断時の送信判定とMCPおよびCronの共通providerを定める
tags: [yamoru, decisions, notifications, integration, cloudflare]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
superseded_by: YDR-070
---

# YDR-069: 検査済みIPのHTTP送信を明示設定されたWorkerで使う

YDR-060・YDR-064・YDR-068の通信経路を具体化する。通知設定、業務データ、購読の保存形式・権限・結果の意味は変更しない。

## 通信と判定

各POSTで固定のCloudflare DoHへA・AAAAを問い合わせる。回答の名前・CNAMEの連鎖・全アドレスを検査し、public以外の混在も拒否する。DNS応答は16 KiB、CNAMEは8段、アドレスは合計16件を上限とする。一つの検査済みIPの443番へraw TCPで接続し、元のhostnameをRustlsへ渡す。callbackへ通常fetchを使う、証明書検証を無効にする、別IPへの自動再試行、redirect追従は行わない。

DNS・接続・TLS・HTTP読取りを含むPOST全体を10秒で中断する。TLSの認証が終わる前に業務の平文を渡さない。アプリケーション書込みの直前から送信開始を保持し、それ以前の失敗は未送信、以後の通信障害は結果不明として既存の分類へ渡す。古い内部connectorが進捗を報告しない場合は従来どおり保守的に開始済みとして扱う。中断後に遅いI/Oが完了しても解放済みTLSを使用せず、native closeの完了待ちで期限を延長しない。

要求本文は既存の256 KiB、TLSの平文書込みは一回16 KiB、暗号文feedは一回64 KiB、受信総量は256 KiB・1024 readまで。Hostは元のhostnameから作り、Authorization・Cookie・hop-by-hopの入力を転送しない。HTTPはCRLFと曖昧さのないframingを要求し、statusとheaderの合計16 KiB・128 fields、情報応答4回までとする。

購読のchallenge確認は4 KiBまで本文を読む。Content-Length・chunked・接続切断で終わる本文を扱い、最後の方式はRustlsが認証したclose_notifyを必要とする。生のTCP EOFを正常終了とはしない。Event配信は最終statusとheaderだけを読み、任意の応答本文を待たずに接続を閉じる。2xxの受領・unknown・再試行はYDR-064のままとし、既読やdotでの案内成功と同一視しない。

## Workerへの接続

`YAMORU_EVENTS_PROVIDER=rustls-pinned-v1`を明示したnative Workerだけにproviderを作る。MCPとCronは同じfactoryを使う。fetchではコピーしたenvのSymbol slotを通してOpenNextへ渡し、既存のOAuth・CORS・予算制限の経路を保つ。元envを変更せず、requestのtransportやsocketをglobalに保存しない。通常のNext devにはnative slotがなく、Eventsは無効のままとする。

native adapterは最初のPOSTで動的に読み込む。WASMの実体は事前コンパイルされたmodule assetを使い、instanceの作成をEvents無効時や通常ページの表示で行わない。loaderは通信処理を保持せず、POSTごとに独立したtransportへ委譲する。

本変更ではe2e環境だけで設定し、previewとproductionでは未設定を維持する。built Worker E2EはEvents有効とprivate宛先の拒否を確認し、通常のNext E2EはEvents無効を確認する。公開fixtureの実Cloudflare試験ではDNSから署名付きPOSTまでを通し、応答・証明書拒否・redirect・本文上限・timeoutを記録する。sourceとWASMのhashを保存し、実測した実装との一致も検査する。

これらは実ChatGPT callbackの購読・到達・解除・失効、定期取得の実行主体と遅延の証明ではない。追加scopeの本人同意と実接続検証を経てからpreviewの有効化を行い、#442はその検証まで開いておく。D1 migrationは不要で、既存の保存済み行を変更しない。

#442の完了に実Events検証を必須とする部分だけは[YDR-070](ydr-070-free-polling-first.md)で置き換え、実Eventsの採用は後続#474で検証する。v0.21.0は定期取得を先行し、preview/productionのproviderは未設定を維持する。本書の通信経路・TLS・宛先制限・中断判定は変更しない。

## 見直す条件

native TLSで固定IPと元hostnameの検証が実証された場合、callbackの到達制約、HTTP互換性、DoHの制約やtrust store更新が必要になった場合に、新しいYDRで経路・上限・切替手順を見直す。
