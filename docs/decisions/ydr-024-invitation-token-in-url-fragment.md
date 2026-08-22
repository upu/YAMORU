---
type: Decision
ydr_id: YDR-024
title: 招待の生tokenをquery stringではなくURL fragmentで搬送する
description: Cloudflareが記録するInvocationログ・Real-time logsへ生の招待tokenが残らないよう、招待リンクの搬送方式をquery stringからURL fragmentへ変更する
tags: [yamoru, decisions, ydr, authentication, invitations, security, cloudflare]
status: stable
decision_status: Accepted
decision_date: 2026-08-22
supersedes: YDR-023
---

# YDR-024: 招待の生tokenをquery stringではなくURL fragmentで搬送する

- 状態: Accepted
- 決定日: 2026-08-22
- 置き換える決定: [YDR-023](ydr-023-invitation-only-account-lifecycle.md)の「招待トークンは推測困難な乱数とし…生トークンを含むURLは最初のサーバー到達後にブラウザーのアドレス欄から取り除き…」の搬送方式のみ。招待の発行・失効ライフサイクル、7日間・一回限り・メール一致の契約、共通エラー、パスワード運用など、YDR-023の他の決定は変更しない。

## 背景

[Issue #140](https://github.com/upu/YAMORU/issues/140)は、[Issue #139](https://github.com/upu/YAMORU/issues/139)のCloudflare preview確認で見つかった。YDR-023は生トークンを`?token=`のquery stringで運び、Workerへの最初の到達直後にD1上の短命claimへ交換してURLから取り除く設計だった。

しかしCloudflare Workersの標準Invocationログは、アプリの除去処理より前の時点で、そのrequestのmethodとrequest URL(query string含む)を記録する。`wrangler tail`によるReal-time logsも同様に`event.request.url`を含む。アプリ内でどれだけ早く除去しても、Workerが受け取った最初のrequest URLはCloudflare側の記録対象になるため、query string方式では生トークンをCloudflareのログ基盤へ残さずに済ませられない。

## 検討した案

- **案1(採用): URL fragment(`#token=`)で生トークンを搬送する。** fragmentはHTTP仕様上ブラウザーからサーバーへのrequestに一切送信されないため、CloudflareのInvocationログ・Real-time logsのどちらにも現れない。クライアント側JavaScriptがfragmentを読み取り、Server Actionのrequest bodyとして送ってD1上の短命claimへ交換する。
- 案2: アプリ内の除去処理をさらに早める、またはCloudflareのInvocationログ自体を無効化する。前者はWorker到達時点でCloudflareが記録するrequest URLを変えられないため効果がない。後者はReal-time logsなど他の経路を含む全経路での非露出を保証できず、障害調査に必要な運用ログまで失う。
- 案3: 招待受諾を常にPOSTで開始する(リンクをフォーム送信の起点にする)。手動共有するプレーンテキストのリンクをPOSTの起点にはできず、家族専用の手動共有運用(YDR-023)と両立しない。

## 決定

### 招待リンクの形式

- 招待発行が返すURLは、`/invitations/accept`に`#token=<生token>`を付けたfragment形式とする。query stringは使わない。
- 招待リンクを開いた最初のrequestは、fragmentなしの`/invitations/accept`としてWorkerへ到達する。この時点でCloudflareが記録するrequest URLに生トークンは含まれない。

### クライアント側での交換

- `/invitations/accept`はクライアント側だけで完結する入口ページとする。ページはアドレス欄のfragmentから生トークンを読み取り、読み取り次第直ちに`history.replaceState`でアドレス欄・閲覧履歴からfragmentを取り除く。
- 読み取った生トークンは、Server Actionの呼び出し(request body)として一度だけサーバーへ渡す。D1上の短命claimへの交換とHttpOnly cookieへの引き継ぎは、YDR-023が定めた契約のまま変更しない。
- 交換の成否によらず、`/invitations/accept/confirm`へ進む。無効・期限切れ・使用済み・取消済み・メール不一致を区別しない共通エラー(YDR-023)は、この画面がそのまま担う。

### JavaScriptが無効な場合

- fragmentはサーバーへ送信されないため、JavaScriptなしでは生トークンを読み取れない。招待受諾はJavaScriptを前提とし、無効時は`noscript`で有効化を案内するにとどめる。セルフホストではなくCloudflare Workers上の家族専用アプリであり、他の認証・登録フォームも同様にクライアント側の状態管理へ依存しているため、この画面だけ無効化時の代替経路を別途設けない。

### 残るリスク

- fragmentはHTTP requestへ送信されないが、ブラウザーのアドレス欄・閲覧履歴には表示される。除去前にアドレス欄からコピーされるリスクは、query string方式と同程度に残る。
- 招待リンクをチャットアプリ等がリンクプレビュー目的でサーバー側からfetchする場合、fragmentは仕様上そのfetchにも送信されないため、query string方式にあった第三者サービスへの生トークン漏えいリスクはこの変更で解消される。

## 結果

- 新たに発行される招待リンクは、Cloudflare Invocationログ・Real-time logsのいずれにも生トークンを残さない。
- 変更対象は招待リンクの生成(`app/household/invitation-actions.ts`)と受諾入口(`app/invitations/accept/`)のみで、D1層の招待・claimスキーマとロジック(`lib/d1/invitations.ts`)は変更しない。
- この変更より前に`?token=`形式で発行済みの招待リンクは、本変更のデプロイ後は受諾できない(共通エラーとなる)。招待は7日間・家庭内の手動共有運用のため、影響がある場合は再発行で足りるとみなす。

## 見直す条件

- fragment方式でもなお生トークンがCloudflareの記録に残ることが実測で判明する。
- 招待受諾でJavaScript非対応環境への対応が必要になる。
- チャットアプリ等のリンクプレビューがfragmentを含めてリクエストする実装が広く観測される。
