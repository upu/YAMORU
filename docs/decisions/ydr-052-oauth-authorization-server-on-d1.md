---
type: Decision
ydr_id: YDR-052
title: 外部クライアントの認可をD1上のOAuth 2.1認可サーバーとして実装し、許可したCIMDクライアントだけを受け付ける
description: 会話エージェント等への委任を、@node-oauth/oauth2-serverとD1の不透明tokenで実装し、client_idの許可リストを設定するまで受付を無効にする
tags: [yamoru, decisions, ydr, integration, oauth]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
---

# YDR-052: 外部クライアントの認可をD1上のOAuth 2.1認可サーバーとして実装し、許可したCIMDクライアントだけを受け付ける

- 状態: Accepted
- 決定日: 2026-10-17
- 関連: [#436](https://github.com/upu/YAMORU/issues/436)、[YDR-049](ydr-049-conversation-command-boundary.md)、[会話連携設計](../product/conversation-integration.md) 3節・8節
- 番号について: YDR-051は#51(必達日)が使うため、この決定は052とする。migrationも同じ理由で0031を使う。

## 背景

[YDR-049](ydr-049-conversation-command-boundary.md)は、外部接続を利用者本人へ結び付け、OAuthのauthorization code + PKCEで認可し、読み取り・変更・通知設定・イベント購読をscopeで分けると決めた。設計は「Auth.jsがそのままMCP向けauthorization serverになるとは扱わない」「OAuth処理は検証済みライブラリを再利用する」「採用ライブラリ・バージョンと適合テスト結果を記録してから接続を有効にする」としている。

YAMORUはOpenNextでCloudflare Workersへ配備するNext.jsアプリであり、データの正本はD1である。接続先として想定するChatGPT系クライアントは、CIMD(Client ID Metadata Document)を第一候補とし、`https://chatgpt.com/oauth/client.json`を公開している(2026-10-17に取得して確認。`token_endpoint_auth_methods_supported`に`none`を含む)。

## 決定

1. 認可サーバーはYAMORU自身(同じWorker)に置き、OAuthのプロトコル処理は`@node-oauth/oauth2-server` 5.3.0(完全一致で固定)へ任せる。PKCEの照合、redirect_uriの完全一致、codeの期限と一回性、refreshのローテーション、scopeの縮小のみ許可はライブラリの実装を使い、YAMORUはmodel(D1への保存)と、家庭・resource・許可clientの条件を担う。5.3.1は採用時点で公開から4日のため見送り、同版で追加された`requirePKCE`相当の検査はYAMORU側(認可要求でのS256必須と、challengeを持たないcodeを保存しないこと)で行う。
2. tokenはJWTではなく、256bitの乱数による不透明tokenとし、D1にはSHA-256だけを保存する。検証のたびにD1で接続の失効・期限・issuer・resource・scope・現在の家庭所属を確かめ、解除をtokenの期限を待たずに反映する。access tokenは1時間、refresh tokenは30日でローテーションし、使用済みrefresh tokenや使用済みcodeの再提示を検知したら接続ごと失効させる。
3. 接続(grant)は同意した利用者本人と、その時点の家庭へ固定する(`oauth_connections`)。所属が変わったら次の利用時に失効させ、別の家庭へ転用しない。パスワードの変更・再設定(`users.session_version`の増加)でも、Webのログイン状態と同じく失効させる。アカウントの乗っ取りから回復する操作で、外部へ委任した権限も確実に止めるためである。再接続は新しい接続として同意を取り直す。解除後も接続の行は履歴として残し、tokenは削除する。
4. クライアントの識別はCIMDだけを受け付ける。Dynamic Client Registrationと事前登録clientは提供しない(DCRはMCP 2026-07-28で非推奨)。公開クライアント(`token_endpoint_auth_method: none` + PKCE)だけを扱い、client secretを送るクライアントは拒否する。
5. CIMDの取得はSSRFの入口になるため、運用者が環境変数`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`に列挙したclient_idの完全一致だけを取得する。さらにHTTPS・path必須・IPアドレスやlocalhost不可、リダイレクト非追従、5KB・5秒の上限を置き、取得結果をD1へ写して24時間使う。token endpointは写しだけを使い、取得しない。
6. 許可リストが空(未設定)の環境では、metadata・同意画面・token/revoke endpointを404にして外部接続を受け付けない。新Workerを配備しただけでは接続は有効にならず、実接続で検証したclient_idを運用者が設定したときだけ有効になる。
7. issuerは要求を受けたオリジン、resource(MCPサーバーの正規URI)は`${issuer}/mcp`とする。previewとproductionはオリジンが異なるため、一方で発行したtokenを他方で受け付けない。認可応答は成功・失敗ともに`iss`を付け(RFC 9207)、metadataで告知する。
8. 同意画面(`/oauth/authorize`)は既存のWebログイン(Auth.js)で本人を確かめ、接続元の名前とclient_idのホスト名、戻り先、家庭名、要求された範囲を示す。読み取り以外の範囲は利用者が外せる。許可・拒否はServer Action(Origin検査によるCSRF対策)で受け、hiddenで受け取った認可要求は信用せず検証し直す。
9. 接続の管理は`/settings/integrations`(アカウント画面から到達)で、本人の接続だけを一覧・解除する。クライアント側からの解除用にrevocation endpoint(RFC 7009)も置く。
10. 運用ログは接続ID・client_id・理由コードだけを残し、token・code・PKCEの値と家庭データを出さない。

## 比較した案

- `@cloudflare/workers-oauth-provider`: Workers向けの実績があるが、Workerの入口全体を包む構成とKV(D1ではない)を前提にする。OpenNextの生成するWorker入口と`next dev`の双方へ差し込む必要があり、家庭境界の検証をD1と同じ処理で行えないため採用しない。
- `oidc-provider`: 適合認定を持つが、Node.jsのHTTPサーバー(Koa)を前提にし、Workers上で動かす変更が大きいため採用しない。
- 自前実装: 依存は減るが、設計が求める「検証済みライブラリの再利用」に反するため採用しない。ライブラリに無い部分(resource、CIMD、所属、再使用検知)だけを足す。
- JWTのaccess token: 解除・所属変更を即時に反映できず、検証のたびにD1を見るなら利点が無いため採用しない。

## 結果と見直す条件

自動テストは、検証済みのOAuthクライアントライブラリ`oauth4webapi` 3.8.8をクライアント役にして、discovery・PKCE・issの検証・codeの交換・refresh・失効を実D1(Workersランタイム)で確かめる。これは実接続の代わりではなく、実際の接続先(dot等)とのmetadata/PKCE/Tool発見の成立はE1として#439/#444で記録する。それまで許可リストを設定しない。

次の場合に見直す。接続先がCIMD以外(事前登録・DCR)やprivate_key_jwtを必須にした場合。ライブラリの保守停止や脆弱性が判明した場合。D1への検証の負荷や遅延が実測で問題になった場合。rate limit(設計の初期値)はMCPアダプタ(#439)で入口ごとに適用する。
