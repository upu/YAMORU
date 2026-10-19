---
type: Playbook
title: 開発テスト用ローカル環境の構築
description: Auth.jsとローカルD1を使ってYAMORUを起動し、開発中の確認と自動テストを行う手順
tags: [yamoru, development, local, authjs, d1, testing]
status: stable
---

# 開発テスト用ローカル環境の構築

この手順では、家庭の実データを使わず、Auth.jsとローカルD1でYAMORUを開発・検証する。スマートフォンやタブレットからの接続とPWA確認は[実端末・PWAの確認](local-device-pwa-verification.md)を参照する。

## 前提

- Node.js 24 LTS
- [mkcert](https://github.com/FiloSottile/mkcert)

WindowsではChocolateyの`choco install mkcert`またはScoopの`scoop install mkcert`でmkcertをインストールできる。

## 初回セットアップ

リポジトリのルートで依存関係をインストールし、環境変数ファイルを用意する。

```
npm install
```

`.env.example`を`.env.local`へ複製する。この一手順だけがshellで異なる。

bash / zshの場合。

```bash
cp .env.example .env.local
```

PowerShellの場合。

```powershell
Copy-Item .env.example .env.local
```

`.env.local`の`AUTH_SECRET`を推測困難なランダム値へ置き換える。パスワード、JWT、招待token、claim secret、`AUTH_SECRET`はコミットしない。

ローカルD1へマイグレーションを適用し、最初のアカウントを作る。

```
npm run d1:migrate
npm run auth:bootstrap
```

`auth:bootstrap`は利用者が一人もいないローカルD1に限り実行できる。公開signupは提供しない。二人目以降は、家庭の管理者が発行した招待URLから登録する。入力値と運用上の注意は[Auth.js初回bootstrapとパスワード再設定](../references/auth-admin-operations.md)を参照する。

## 開発サーバーを起動する

```
npm run dev
```

`npm run dev`は開発用HTTPSを既定とする。初回実行時にmkcertがローカルCAをWindowsの証明書ストアへ登録し、`localhost`、`127.0.0.1`、`::1`向けの証明書を`.certs/dev/`へ生成する。証明書と秘密鍵はGit管理対象外である。

ブラウザで[https://localhost:3000](https://localhost:3000)を開く。証明書に対応するホストが増えた場合や証明書の期限が切れた場合は、次回起動時に自動で再生成される。証明書だけを手動で再生成・確認する場合は`npm run dev:cert`を使う。

HTTPでの起動が必要な場合に限り、明示的なフォールバックとして`npm run dev:http`を使う。

## ローカルで基本動作を確認する

1. 未認証でホームを開くとログイン画面へ移動することを確認する。
2. `auth:bootstrap`で登録した認証情報でログインする。
3. アカウント画面でニックネームと最初の家庭を作成する。
4. 再読み込み後も同じ家庭を表示できることを確認する。
5. ログアウト後はログイン画面へ移動し、同じ認証情報で再ログインできることを確認する。

## 自動テストを実行する

### 開発中は変更した範囲から選ぶ

まず[機能ごとの修正箇所マップ](../components/index.md)から対象機能を開き、「検証方法」で関連テストを選ぶ。次の表は検証の選び方であり、機能別のテスト一覧は各Component文書を正本とする。コマンドはリポジトリのルートで実行する。

| 変更内容 | 開発中の対象検証 | 最終確認 |
|---|---|---|
| 文書だけ、または画面の説明文だけ | 文書はリンク先・コマンド・仕様との整合と`git diff --check`。画面の文言は関連する表示テストと、実画面で意味・折り返し・アクセシブルな名前を確認する | 文書だけなら差分確認とPRの全CI。画面を変更した場合は下記の品質確認も行う |
| UI操作・フォーム・画面遷移 | 対象のcomponent/actionテスト。保存、認証、画面をまたぐ操作は関連するPlaywrightのspecも実行する | 下記の品質確認。データアクセスも変わる場合はD1の行も適用する |
| 純粋計算・入力解釈 | 対象のunitテストで正常系と境界値を確認する。暦計算では月末・年越し・タイムゾーンなどの既存条件を維持する | 下記の品質確認。計算結果を使う保存や表示にも影響する場合は、そのテストへ広げる |
| D1スキーマ・読み書き・認可 | [データベースの変更手順](../references/database-change-playbook.md)に沿い、関連するD1テストと呼び出し側のaction/HTTPテストを実行する | 同手順の全ゲートと下記の品質確認。家庭間分離・IDOR・原子性・再送時の冪等性を省略しない |

対象ファイルに絞る例（ファイル名は変更した機能のものへ置き換える）。

```
# UIの文言・操作
npm test -- tests/assignee-panel.test.tsx
# 純粋な暦計算
npm test -- tests/d1-calendar.test.ts
# 実D1上の家庭間分離・Todo操作
npm run test:d1 -- src/lib/d1/todos-authorization.d1-test.ts
# ブラウザでのTodo編集（初回は後述のChromiumをインストールする）
npm run test:e2e:local -- e2e/todo-edit.spec.ts
```

`npm test`の既定環境はNodeである。DOM描画やブラウザAPIが必要なテストだけ、ファイル先頭に`// @vitest-environment jsdom`を明示する。`.tsx`という拡張子だけではjsdomにならない。D1バインディングを使う`src/lib/d1/**/*.d1-test.ts`は通常の`npm test`から除外され、`npm run test:d1`の専用Workers環境で実行する。Node/jsdomでのmockの成功だけでは、実D1の境界や原子性を確認できない。

次の場合は、対象ファイルだけの確認から範囲を広げる。

- 関連テストを特定できない、または影響先を説明できない場合は、`npm test`など該当するテスト群を全件実行する。
- 共通のUI/action・認証・家庭境界・日時処理・テスト設定やfixture・依存関係を変える場合は、利用側の機能にも広げる。認可や保存に触れる場合は、関係するD1境界テストも実行する。
- 対象検証で想定外の失敗が出た場合は、原因と影響先を確認し、隣接するテストへ広げる。再実行の成功だけを原因の説明にしない。

対象検証は開発中の反復を短くするための手順であり、PRの必須CIを減らすものではない。

### 最後に品質を確認する

コードを変更した場合は、対象検証が通った後で次を実行する。文書だけの変更ではローカルの全件テスト・ビルドを繰り返さず、リンク・コマンド・差分を確認し、PRの全CIの結果を確認する。

```
npm run lint
npm run typecheck
npm test
npm run d1:migrate
npm run d1:schema:check
npm run test:d1
npm run build
```

`npm run test:d1`は、実D1上で家庭間分離、IDOR耐性、複数行更新の原子性を確認する。ローカルD1へのマイグレーション適用と生成スキーマの整合確認も行う。スキーマを変更した場合は、先に[データベースの変更手順](../references/database-change-playbook.md)の生成・検証手順を完了する。

続いて家族招待を含むブラウザ操作をE2Eで確認する。初回だけChromiumのインストールが必要である。

```
npm run test:e2e:install
npm run test:e2e:local
```

`test:e2e:local`はE2E専用の空のローカルD1へマイグレーションと架空fixtureを適用する。通常のローカルD1や家庭の実データは使わない。

MCP入口とOAuthをCloudflare向けのビルドでも確認する場合は、`npm run test:e2e:worker`を実行する。OpenNextをビルドし、e2e環境のローカルWorker(`localhost:8787`)で専用の通しテストを実行する。`test:e2e:local`とは順番に実行し、同じ`.next`を使うビルドと開発サーバーを同時に動かさない。実dotの接続確認は[MCP Component](../components/mcp.md)の未完了境界を参照する。

同じcheckoutでは`npm run build`・`npm run cf:build`・開発サーバー（E2Eが起動するものも含む）を同時に実行しない。`.next`を共有するため、開発サーバーを停止してから順番に実行する。E2Eは既存サーバーを再利用せず、通常のE2Eはポート3000、Worker E2Eは8787を使う。

Pull Requestと`main`へのpushでは、GitHub Actionsの[Quality checks](../../.github/workflows/ci.yml)がlint・typecheck・build、unit/component全件、通常のE2E全件、空のローカルD1へのマイグレーション適用・生成スキーマ検査・家庭間分離と原子性、ビルド済みWorkerのMCP/OAuth E2Eを確認する。PRの最新commitに対して全jobの成功を確認する。ローカルの対象検証や通常のNext devでの成功だけで、Worker E2Eの成功や実際の外部接続・通知到達を確認済みとは扱わない。
