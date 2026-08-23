---
type: Playbook
title: Cloudflare productionの構築・デプロイ・復旧
description: YAMORUをCloudflare WorkersとD1へ安全に配備し、環境分離、Secrets、マイグレーション、ログ、ロールバックを運用する手順
tags: [yamoru, cloudflare, workers, d1, deployment, operations]
status: stable
stale_after: 2026-11-21
---

# Cloudflare productionの構築・デプロイ・復旧

この手順は[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)と[YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)に基づく。

## 環境の境界

| 環境 | Worker | D1 | 用途 |
|---|---|---|---|
| local | `yamoru`(デプロイしない) | `yamoru-local` | 日常開発。`.wrangler/`内だけに保存する |
| preview | `yamoru-preview` | `yamoru-preview` | Cloudflare上での事前確認。家庭の実データを入れない |
| production | `yamoru-production` | `yamoru-production` | 家族が利用する本番。previewとは認証情報と実データを分離する |

三環境は同じ`DB` binding名を使うが、`wrangler.jsonc`の環境ごとに異なるD1名と`database_id`を指定する。Auth管理コマンドは、本体Workerのbindingから分離した`config/wrangler/auth-admin.jsonc`でも同じD1を指定し、preview / productionの対象bindingだけをremote接続する。remote Auth管理では処理中だけ一回限りのtokenで保護した管理用Workerを起動し、認証情報をCLI引数、設定ファイル、ログへ渡さない。remote migrationと管理コマンドは対象名の完全一致を要求する。`wrangler`を直接使ってremote D1を変更せず、環境名入りのnpm scriptを使う。

## 最初のCloudflareリソースを作る

前提はCloudflareアカウントとNode.js 24 LTSである。Workers Freeプランから開始できる。Wranglerの対話認証を行う。

```powershell
npx wrangler login
```

ログインしたアカウントがYAMORUの所有先であることをDashboardで確認してから、previewとproductionを別のD1として作る。日本の家庭利用を想定し、location hintはAsia Pacificにする。

```powershell
npx wrangler d1 create yamoru-preview --location apac
npx wrangler d1 create yamoru-production --location apac
```

各コマンドが返した`database_id`を、`wrangler.jsonc`と`config/wrangler/auth-admin.jsonc`の対応するplaceholderへ設定する。IDは秘密情報ではないが、環境を識別する正本なので転記後に次を実行する。

```powershell
npm run cf:config:check
```

OKの基準は、preview / productionのWorker名とD1 bindingを確認した旨が表示され、二つの`database_id`が異なること。既に同名DBが存在する場合は再作成せず、`npx wrangler d1 list`でIDを確認する。

## Auth.jsのSecretsを設定する

`AUTH_SECRET`はpreviewとproductionで別の推測困難な値にする。値をIssue、設定ファイル、コマンドライン引数、ログへ書かず、パスワードマネージャー等で生成した値をWranglerの対話入力へ渡す。

```powershell
npx wrangler secret put AUTH_SECRET --env preview
npx wrangler secret put AUTH_SECRET --env production
```

SecretsはCloudflare側で管理され、読み戻せない。デプロイは`--keep-vars`を使い、Dashboardで管理するruntime変数を消さない。`AUTH_SECRET`を変更すると既存JWTが無効になるため、計画した全員再ログイン時だけローテーションする。

Auth.jsのホスト信頼は`auth.config.ts`の`trustHost: true`で明示している。Cloudflare Workersは受信したHostヘッダーを実際の公開URLから設定するため、公式リファレンスに従いlocal / preview / productionで同じ値を使う。ログイン画面で`There was a problem with the server configuration.`が表示され、`wrangler tail`のログに`UntrustedHost`が出る場合は、この設定が反映されたビルドが配備されているかを確認する(#137)。

## previewへ初回配備して確認する

まずpreview D1へマイグレーションを適用する。コマンドが求める確認には`yamoru-preview`を完全一致で入力する。

```powershell
npm run d1:migrate:preview
npm run cf:build
npm run cf:deploy:preview
```

Wranglerが表示した公開HTTPS URLを使い、公開資産と認証境界を確認する。

```powershell
npm run cf:smoke -- https://yamoru-preview.<workers-subdomain>.workers.dev
```

OKの基準は、manifest、アイコン、招待入口、ログイン画面、保護されたアカウント画面の5項目がすべて`OK`になること。続けてpreviewの最初の利用者を作る。対象確認には`yamoru-preview`を入力し、メールアドレスとパスワードは対話入力する。

```powershell
npm run auth:bootstrap:preview
```

preview URLのログイン画面でログインし、ニックネームと架空の家庭を作成する。再読み込み後も表示できれば、Workersからpreview D1への基本接続が成立している。previewには家庭の実データを入れない。

初回構築後は、mainへのpushに対する`Quality checks`が成功すると`.github/workflows/deploy-preview.yml`が同じcommit SHAをcheckoutし、preview migration、Cloudflare build、deploy、公開境界smokeを順に実行する。Pull Requestのhead、失敗したmain、stable Releaseの公開はpreview自動配備の契機にしない。緊急調査以外はローカルから手動配備しない。家族利用の主要導線に対するE2Eは、mainへのpush毎ではなくstable Releaseを作る直前にだけ実行する([下記](#stable-release前のpreview家族通し確認))。

## GitHub Environmentsを設定する

Cloudflare DashboardでYAMORU専用のAPI tokenを作り、対象AccountをYAMORUの所有アカウントだけに限定する。必要な権限はWorkers Scriptsの編集とD1の編集である。Global API Keyは使わない。

GitHubの`preview` Environmentへ次を設定する。

- Secret `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Dashboardに表示されるAccount ID
- Secret `CLOUDFLARE_API_TOKEN`: 上記の限定API token
- Variable `YAMORU_PREVIEW_URL`: `https://yamoru-preview.<workers-subdomain>.workers.dev`

GitHubの`production` Environmentにも、production用として次を設定する。

- Secret `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Dashboardに表示されるAccount ID
- Secret `CLOUDFLARE_API_TOKEN`: 上記の限定API token
- Variable `YAMORU_PRODUCTION_URL`: `https://yamoru-production.<workers-subdomain>.workers.dev`またはカスタムドメインのHTTPS URL

同じAPI tokenを両Environmentへ登録してもよいが、リポジトリ全体のSecretへ広げず、workflow jobが指定したEnvironmentからだけ参照する。Cloudflare runtimeの`AUTH_SECRET`はGitHubへ登録せず、preview / production Worker側で別々に管理する。

## stable Release前のpreview家族通し確認

v0.3.0では、家族2アカウントを使ったpreview通し確認を人手で行っていた(#139)。v0.4.1からは、この確認を`e2e/preview/family-sharing.spec.ts`によるPlaywright E2Eへ全面自動化し、Go/No-Go判定自体をCIへ委譲する(Issue #151)。人手による全項目通しは必須ではない。mainへのpush毎ではなく、stable Releaseを作る直前にだけ実行する。

### いつ実行するか

`.github/workflows/preview-family-sharing-e2e.yml`は、GitHubでRelease Draftを保存した後に、Actions画面または`gh workflow run preview-family-sharing-e2e.yml -f release_tag=vX.Y.Z -f target_sha=<Draftの対象SHA> --ref main`で明示実行する。GitHub ActionsはDraft Releaseの`created`イベントを起動せず、workflowの`GITHUB_TOKEN`から未公開Draftを取得できないため、この一操作と事前照合をリリース手順に含める(Issue #167)。運用者はDraftが対象にする完全なcommit SHAを入力し、workflowは起動元が`main`であることと、そのSHAが起動時の`main` commitに一致することを検証してからcheckoutする。その時点で配備済みのpreview環境(mainへのpushのたびに`deploy-preview.yml`が最新化している)に対してE2Eを実行する。`deploy-preview.yml`自体はこのE2Eを含まず、従来どおりmigration・build・deploy・公開境界smokeだけを行う。

### 自動確認する内容

1. `scripts/e2e-admin-remote.ts`が、preview D1専用の一時Worker([config/wrangler/e2e-admin.jsonc](../../config/wrangler/e2e-admin.jsonc)、preview envのみを定義)を介して、固定の架空テストアカウント(`e2e-owner@example.test`・`e2e-outsider@example.test`)をメールアドレス経由で消してから作り直す。これらのアカウントが所属する家庭はON DELETE CASCADEでメンバー・管理対象・Todo・履歴・招待もまとめて消える。パスワードは実行のたびに生成し、Playwrightのプロセス内だけで使ってログ・Issueへ出さない。
2. `e2e/preview/family-sharing.spec.ts`が、配備済みpreview URLへ直接アクセスし、次を1つの通しシナリオとして確認する。
   - ニックネーム登録・家庭作成(初回セットアップ導線)
   - Todo作成と完了操作
   - 招待発行・招待受諾によるアカウント登録・家庭参加、完了記録の共有可視性
   - 既に別の家庭に所属するアカウントへの招待が家庭間分離により拒否されること
   - 未認証での保護画面アクセスがログインへ移動すること

このjobが失敗すれば、そのRelease DraftはNo-Goとして扱う。GitHub Actionsの`Preview family sharing E2E`workflow実行に記録されたtagと対象SHAが、そのままGo/No-Goの記録になる。

### 対象外(production受入確認として分離)

- production固有のSecret入力、実データ入力、実端末確認は、production公開後の受入確認として別に行う([最初の利用者を作る](#stable-releaseからproductionへ配備する)以降を参照)
- 下部ナビゲーションの表示崩れなど、実端末でしか再現しない見た目の確認は対象外(必要に応じて[実端末・PWAの確認](../development/local-device-pwa-verification.md)を使う)

### 問題を見つけたとき

`e2e/preview/family-sharing.spec.ts`が失敗した場合、失敗したstep・アサーション・Playwrightのtraceを添えて再現手順付きのIssueを起票する。Draftは`Publish release`せずそのまま残すか削除し、修正commitがmainへ入って対象commitをpreviewが反映してから、新しいRelease Draftを作り直してE2Eを再確認する。

### ローカルで同じ確認を実行する

Cloudflareへログイン済み(`npx wrangler login`)であれば、Release Draftを作る前にローカルから同じpreview URLに対して確認できる。

```powershell
npm run test:e2e:install
$env:CLOUDFLARE_ACCOUNT_ID = "<Cloudflare Dashboardに表示されるAccount ID>"
$env:YAMORU_PREVIEW_URL = "https://yamoru-preview.<workers-subdomain>.workers.dev"
npm run test:e2e:preview
```

`e2e-admin`一時Workerはpreview D1だけをbindし、production envを定義しないため、誤ってproductionを対象にした実行はconfig解決の時点で失敗する。

## stable Releaseからproductionへ配備する

mainへのマージだけではproductionへ配備しない。`.github/workflows/deploy-production.yml`はstableなGitHub Releaseの`published`イベントで起動し、Releaseタグのcommitへ`Quality checks`を再実行する。成功後、タグが`vX.Y.Z`形式で、checkout済みHEADと一致し、mainに含まれることを確認してから、production migration、Cloudflare build、deploy、公開境界smokeを順に実行する。

productionへ出すときは次の順で操作する。

1. Release対象のmain commitに対する`Deploy preview`(公開境界smoke)が成功していることを確認する。
2. GitHubのReleasesからDraftを作り、`vX.Y.Z`形式の新しいタグと最新のmain commitの完全なSHAを指定する。保存後にDraftが`draft: true`・`prerelease: false`で、対象SHAが手順1と一致することをReleases画面または`gh release view vX.Y.Z --json isDraft,isPrerelease,targetCommitish`で照合する。
3. `Preview family sharing E2E`をActions画面または`gh workflow run preview-family-sharing-e2e.yml -f release_tag=vX.Y.Z -f target_sha=<Draftの対象SHA> --ref main`で実行し、家族利用の主要導線([前述](#stable-release前のpreview家族通し確認))をpreview上で確認する。
4. workflowが入力SHAと起動時の`main` commitを照合したうえで成功していることを確認する。失敗していればこのDraftはNo-Goとして扱い、原因のIssue化と解消・再確認を先に行う(修正後は新しいDraftを作り直す)。
5. Release notesと対象commitを見直す。`Set as a pre-release`は選ばない。
6. `Publish release`を実行する。この操作がproduction反映の承認になる。
7. GitHub Actionsの`Deploy production`で、quality、target確認、migration、deploy、smokeがすべて成功したことを確認する。

Draftとpre-releaseはproductionへ配備しない。不正なタグやmainに含まれないcommitではproduction変更前に失敗する。Releaseタグを書き換えて再利用せず、修正をmainとpreviewで確認してから新しいpatch Releaseを作る。

初回デプロイ後、productionの最初の利用者を作る。対象確認には`yamoru-production`を入力する。

```powershell
npm run auth:bootstrap:production
```

production URLでログイン画面まで到達し、作成した認証情報でログインできることを確認する。その後、アプリの画面からニックネーム、家庭、Todoなど必要なデータを登録する。

## 日常のマイグレーションとデプロイ

スキーマ変更は[データベースに影響する変更の手順](database-change-playbook.md)に従い、先にlocalとmainから自動配備されるpreviewで確認する。productionへはstable Releaseの自動デプロイだけで適用する。workflowはmigrationを新Workerより先に適用するため、migrationは現在稼働中のWorkerとも互換なexpand-first変更にする。破壊的な削除・rename・制約強化は、先に新旧両方で動くschemaとコードを配備し、後続issueで利用停止を確認してから行う。D1 migrationは適用直前にバックアップを取得し、途中で失敗したmigrationをロールバックするが、既に成功した過去migrationまでは戻さない。

緊急時を除き、ローカルから`cf:deploy:production`や`d1:migrate:production`を直接実行しない。緊急操作を行った場合は、理由、対象Worker/D1、commit SHA、時刻、結果をIssueへ秘密情報なしで記録し、リポジトリの状態と実環境を再同期する。

## ログを確認する

`wrangler.jsonc`でWorkers Logsを有効にしている。Cloudflare DashboardのWorkers & Pagesから`yamoru-production`を選び、ObservabilityでInvocation、例外、HTTP statusを確認する。リアルタイム確認は次を使う。

```powershell
npx wrangler tail --env production --format pretty
```

パスワード、JWT、`AUTH_SECRET`、生の招待token・claim secret、招待先メールアドレス本文をログへ出さない。障害調査には時刻、Worker version、HTTP status、非秘匿ID、Cloudflare Ray IDを使う。

### URLに秘密情報を含めない確認方法

CloudflareのInvocationログとReal-time logsは、アプリ独自の除去処理より前にrequestのmethodと完全なrequest URL(query string含む)を記録する。招待受諾など秘密値をURLで扱う経路を変更した場合は、実tokenを使わず次の手順で確認する([YDR-024](../decisions/ydr-024-invitation-token-in-url-fragment.md)、Issue #140)。

1. previewで`npx wrangler tail --env preview --format pretty`を開始する。
2. 実在しない非秘密のダミー値だけを使い、確認対象のURLを開く(招待受諾の場合は`/invitations/accept#dummy-nonsecret-value`のようにfragmentへ置き、query stringには置かない)。
3. Invocationログ・Real-time logsのどちらにも、そのrequestのURLにダミー値が含まれないことを確認する。fragmentはHTTP request自体に送信されないため、想定どおりならログの`request.url`は`/invitations/accept`のみになる。
4. 実際の秘密値では再現しない。

### ローカルのworkerdでは再現しないWorkers固有の制約

ローカルのvitestやlocal `wrangler dev`(non-remote)が使うworkerdは、実際にデプロイされたCloudflare edgeと完全には一致しない。例えば`crypto.subtle`/`node:crypto`のPBKDF2は、実機では反復回数100,000回を超えると`NotSupportedError`になるが、ローカルのworkerdはこの上限を再現しない([YDR-025](../decisions/ydr-025-pbkdf2-iterations-within-workers-limit.md)、Issue #142)。ローカルのテストや`wrangler dev`が通っても実機で失敗しうる変更(暗号API、CPU/メモリに依存するAPIなど)は、`wrangler dev --remote`で実機相当の挙動を確認してからpreviewへ配備する。

## Workerをロールバックする

まずproductionのdeployment履歴を確認する。

```powershell
npx wrangler deployments list --env production
```

戻すversionが現在のD1 schemaと互換であることを確認できる場合だけ、version IDを指定してWorkerを戻す。

```powershell
npx wrangler rollback <version-id> --env production
```

コードのrollbackはD1 migrationを戻さない。古いコードが新しいschemaと互換でない場合は、rollbackせずforward fixを行う。

## D1を復旧する

D1 Time Travelは、データ破損・誤削除が確認された事故時だけ使う。復旧時点より後の正しい変更も失われる破壊的操作なので、通常のコードrollbackと同時に自動実行しない。

1. 書き込みを止め、事故時刻と対象が`yamoru-production`であることを二人目または記録と照合する。
2. 現在のproduction D1をexportして保全する。
3. `time-travel info`で復旧時点のbookmarkを確認する。
4. 影響を説明し、明示承認を得てから`time-travel restore`を実行する。
5. smoke、ログイン、件数、直近履歴を確認する。

復旧コマンドは事故ごとにCloudflare公式手順を再確認し、DB名と`--env production`を同時に指定する。手順書へ固定のbookmarkや時刻を書かない。

## 参照

- [Cloudflare D1 Getting started](https://developers.cloudflare.com/d1/get-started/) - アカウント、D1作成、binding、remote適用
- [Cloudflare D1 Environments](https://developers.cloudflare.com/d1/configuration/environments/) - 環境ごとの別D1 binding
- [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) - Account IDと限定API token
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) - ログ保存と確認
- [Cloudflare Workers Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) - version rollback
- [GitHub Actionsのrelease event](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#release) - stable Release公開時のtag refとcommit
- [GitHub Actionsの再利用workflow](https://docs.github.com/actions/how-tos/reuse-automations/reuse-workflows) - Release commitへQuality checksを再実行する構成
