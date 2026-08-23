---
type: Playbook
title: Auth.js初回bootstrapとパスワード再設定
description: local、preview、productionのD1で最初のアカウントを一度だけ作成し、運用者がパスワードを再設定する手順
tags: [yamoru, authjs, d1, authentication, operations]
status: stable
---

# Auth.js初回bootstrapとパスワード再設定

この手順は[YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)に基づく。公開signupやセルフサービスのパスワード回復は提供しない。既定の管理コマンドはlocal D1だけを対象とし、remote操作はpreview / productionを明示する専用コマンドと対象名の完全一致確認を要求する。

Auth管理コマンドは、アプリ本体のbindingやSecretを含まない`config/wrangler/auth-admin.jsonc`を接続境界として使う。local bindingはローカル専用、preview / production bindingはそれぞれ対応するD1だけを`remote: true`にする。remote操作では処理の間だけCloudflare上に管理用Workerを起動し、ローカルで生成したパスワードhashを一回限りのtokenで保護したrequest bodyとして渡す。メールアドレス、パスワード、hash、tokenをCLI引数、設定ファイル、ログへ渡さず、終了時に管理用Workerを停止する。remote D1の`database_id`を変更した場合は、`wrangler.jsonc`とこの管理専用設定を同じ変更で更新し、自動テストで一致を確認する。

## 事前準備

`.env.local`へ推測困難な`AUTH_SECRET`を設定し、D1マイグレーションを適用する。秘密値はコミットしない。

```powershell
npm run d1:migrate
```

## 最初のアカウントを作る

利用者が一人もいないD1に対して一度だけ実行する。

```powershell
npm run auth:bootstrap
```

プロンプトへメールアドレス、8文字以上のパスワード、同じパスワードの確認を入力する。メールアドレスとパスワードをコマンドライン引数へ付けてはいけない。成功後は通常のログイン画面からログインし、アカウント画面でニックネームと最初の家庭を作成する。

OKの基準は、コマンドが「認証情報を更新しました」と表示し、その認証情報でログインできること。二回目は何も変更せず失敗し、既存の認証情報で引き続きログインできること。

失敗時は、操作対象名の不一致、メールアドレス形式、パスワードの最小文字数、2回のパスワード不一致、入力の読み取り、パスワード処理、Cloudflare接続、D1状態のどこを見直すべきかを個別に表示する。入力値そのもの、秘密情報、Cloudflareの生のエラー本文は表示しない。D1状態のエラーでは、bootstrapなら利用者が既に存在しないかとmigration適用済みか、パスワード再設定なら対象利用者が存在するかとmigration適用済みかを確認する。

Cloudflare上のpreview / productionを対象にする場合は、先に[Cloudflare productionの構築・デプロイ・復旧](cloudflare-production-operations.md)に従ってD1 migrationとWorkerの配備を済ませる。対象確認へそれぞれ`yamoru-preview` / `yamoru-production`を入力する。

```powershell
npm run auth:bootstrap:preview
npm run auth:bootstrap:production
```

## パスワードを運用者が再設定する

利用者がパスワードを忘れた場合だけ実行する。

```powershell
npm run auth:reset-password
```

対象メールアドレス、新しい8文字以上のパスワード、確認をプロンプトへ入力する。成功すると対象利用者の`session_version`も増え、既存のJWTセッションはすべて失効する。

OKの基準は、古いパスワードでログインできず、新しいパスワードでログインできること。対象メールアドレスが存在しない場合は何も変更せず失敗する。

remote D1の再設定には環境名入りのコマンドを使い、対象確認へDB名を完全一致で入力する。

```powershell
npm run auth:reset-password:preview
npm run auth:reset-password:production
```

利用者がパスワードを忘れていない場合でも、password hashに埋め込まれた反復回数がその時点の`PASSWORD_HASH_ITERATIONS`([YDR-025](../decisions/ydr-025-pbkdf2-iterations-within-workers-limit.md))を超えていると、ログイン画面には認証情報不一致と同じ汎用エラーが表示される。この場合も上記の再設定で解決する。

## 秘密情報の扱い

- パスワードをCLI引数、設定ファイル、Issue、ログへ書かない。
- `password_hash`、JWT、招待token、claim secret、`AUTH_SECRET`を表示・共有しない。
- 標準入力を使う自動化では、メールアドレス・パスワード・確認の3行を安全な秘密入力元から渡し、シェル履歴や平文ファイルへ残さない。
- `wrangler`や`scripts/auth-admin.ts`を直接実行せず、対象環境が名前に入った上記のnpm scriptを使う。
