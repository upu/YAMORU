---
type: Playbook
title: Auth.js初回bootstrapとパスワード再設定
description: ローカルD1で最初のアカウントを一度だけ作成し、運用者がパスワードを再設定する手順
tags: [yamoru, authjs, d1, authentication, operations]
status: stable
---

# Auth.js初回bootstrapとパスワード再設定

この手順は[YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)に基づく。公開signupやセルフサービスのパスワード回復は提供しない。現在の管理コマンドはローカルD1だけを対象とし、Cloudflare本番D1の対象選択と誤操作ガードはIssue #123で追加する。

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

プロンプトへメールアドレス、12文字以上のパスワード、同じパスワードの確認を入力する。メールアドレスとパスワードをコマンドライン引数へ付けてはいけない。成功後は通常のログイン画面からログインし、アカウント画面でニックネームと最初の家庭を作成する。

OKの基準は、コマンドが「認証情報を更新しました」と表示し、その認証情報でログインできること。二回目は何も変更せず失敗し、既存の認証情報で引き続きログインできること。

## パスワードを運用者が再設定する

利用者がパスワードを忘れた場合だけ実行する。

```powershell
npm run auth:reset-password
```

対象メールアドレス、新しい12文字以上のパスワード、確認をプロンプトへ入力する。成功すると対象利用者の`session_version`も増え、既存のJWTセッションはすべて失効する。

OKの基準は、古いパスワードでログインできず、新しいパスワードでログインできること。対象メールアドレスが存在しない場合は何も変更せず失敗する。

## 秘密情報の扱い

- パスワードをCLI引数、設定ファイル、Issue、ログへ書かない。
- `password_hash`、JWT、招待token、claim secret、`AUTH_SECRET`を表示・共有しない。
- 標準入力を使う自動化では、メールアドレス・パスワード・確認の3行を安全な秘密入力元から渡し、シェル履歴や平文ファイルへ残さない。
