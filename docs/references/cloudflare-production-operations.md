---
type: Playbook
title: Cloudflare productionの構築・デプロイ・復旧
description: YAMORUをCloudflare WorkersとD1へ安全に配備し、環境分離、Secrets、マイグレーション、ログ、ロールバックを運用する手順
tags: [yamoru, cloudflare, workers, d1, deployment, operations]
status: stable
stale_after: 2026-11-21
---

# Cloudflare productionの構築・デプロイ・復旧

この手順は[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)と[YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)に基づく。家庭の実データをproduction D1へ投入する作業はIssue #124で行い、本手順には含めない。

## 環境の境界

| 環境 | Worker | D1 | 用途 |
|---|---|---|---|
| local | `yamoru`(デプロイしない) | `yamoru-local` | 日常開発。`.wrangler/`内だけに保存する |
| preview | `yamoru-preview` | `yamoru-preview` | Cloudflare上での事前確認。家庭の実データを入れない |
| production | `yamoru-production` | `yamoru-production` | 家族が利用する本番。Issue #124完了前は実データを入れない |

三環境は同じ`DB` binding名を使うが、`wrangler.jsonc`の環境ごとに異なるD1名と`database_id`を指定する。remote migrationと管理コマンドは対象名の完全一致を要求する。`wrangler`を直接使ってremote D1を変更せず、環境名入りのnpm scriptを使う。

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

各コマンドが返した`database_id`を、`wrangler.jsonc`の対応するplaceholderへ設定する。IDは秘密情報ではないが、環境を識別する正本なので転記後に次を実行する。

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

初回構築後は、mainへのpushに対する`Quality checks`が成功すると`.github/workflows/deploy-preview.yml`が同じcommit SHAをcheckoutし、preview migration、Cloudflare build、deploy、公開境界smokeを順に実行する。Pull Requestのhead、失敗したmain、stable Releaseの公開はpreview自動配備の契機にしない。緊急調査以外はローカルから手動配備しない。

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

## stable Releaseからproductionへ配備する

mainへのマージだけではproductionへ配備しない。`.github/workflows/deploy-production.yml`はstableなGitHub Releaseの`published`イベントで起動し、Releaseタグのcommitへ`Quality checks`を再実行する。成功後、タグが`vX.Y.Z`形式で、checkout済みHEADと一致し、mainに含まれることを確認してから、production migration、Cloudflare build、deploy、公開境界smokeを順に実行する。

productionへ出すときは次の順で操作する。

1. Release対象のmain commitがpreviewへ配備済みで、previewのsmokeと必要な手動確認が成功していることを確認する。
2. GitHubのReleasesからDraftを作り、`vX.Y.Z`形式の新しいタグとmain上の対象commitを指定する。
3. Release notesと対象commitを見直す。`Set as a pre-release`は選ばない。
4. `Publish release`を実行する。この操作がproduction反映の承認になる。
5. GitHub Actionsの`Deploy production`で、quality、target確認、migration、deploy、smokeがすべて成功したことを確認する。

Draftとpre-releaseはproductionへ配備しない。不正なタグやmainに含まれないcommitではproduction変更前に失敗する。Releaseタグを書き換えて再利用せず、修正をmainとpreviewで確認してから新しいpatch Releaseを作る。

初回デプロイ後、productionの最初の利用者を作る。対象確認には`yamoru-production`を入力する。

```powershell
npm run auth:bootstrap:production
```

production URLでログイン画面まで到達し、作成した認証情報でログインできることを確認する。Issue #124まではニックネーム・家庭・実Todoの投入を行わない。

## 日常のマイグレーションとデプロイ

スキーマ変更は[データベースに影響する変更の手順](database-change-playbook.md)に従い、先にlocalとmainから自動配備されるpreviewで確認する。productionへはstable Releaseの自動デプロイだけで適用する。workflowはmigrationを新Workerより先に適用するため、migrationは現在稼働中のWorkerとも互換なexpand-first変更にする。破壊的な削除・rename・制約強化は、先に新旧両方で動くschemaとコードを配備し、後続issueで利用停止を確認してから行う。D1 migrationは適用直前にバックアップを取得し、途中で失敗したmigrationをロールバックするが、既に成功した過去migrationまでは戻さない。

緊急時を除き、ローカルから`cf:deploy:production`や`d1:migrate:production`を直接実行しない。緊急操作を行った場合は、理由、対象Worker/D1、commit SHA、時刻、結果をIssueへ秘密情報なしで記録し、リポジトリの状態と実環境を再同期する。

## ログを確認する

`wrangler.jsonc`でWorkers Logsを有効にしている。Cloudflare DashboardのWorkers & Pagesから`yamoru-production`を選び、ObservabilityでInvocation、例外、HTTP statusを確認する。リアルタイム確認は次を使う。

```powershell
npx wrangler tail --env production --format pretty
```

パスワード、JWT、`AUTH_SECRET`、生の招待token・claim secret、招待先メールアドレス本文をログへ出さない。障害調査には時刻、Worker version、HTTP status、非秘匿ID、Cloudflare Ray IDを使う。

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
