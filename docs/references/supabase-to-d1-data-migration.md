---
type: Playbook
title: Supabaseローカルprodからproduction D1へのデータ移行
description: 既存のYAMORU-prod-localをバックアップし、Auth.js利用者を対応付けてCloudflare D1へ一度だけ安全に移行・検証・復旧する手順
tags: [yamoru, supabase, d1, migration, production, operations]
status: stable
stale_after: 2026-11-21
---

# Supabaseローカルprodからproduction D1へのデータ移行

この手順は[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)と[YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)に基づく、Issue #124の一回限りのデータ移行手順である。移行元はproject IDが`YAMORU-prod-local`のローカルSupabase、移行先はCloudflare D1の`yamoru-production`だけに固定する。

移行後も旧Supabase環境とバックアップを削除しない。パスワードハッシュ、セッション、refresh tokenはD1へ移さず、家庭の実データやtoken hashを画面・Issue・ログへ出力しない。

## 前提条件

- Issue #121、#122、#123が完了している。
- Docker Desktopと`YAMORU-prod-local`が起動している。
- 対象commitのlocalゲートとmainのCIが成功し、previewで同じD1 schemaとWorkerを確認している。
- production D1へ`d1/migrations/0003_preserve_supabase_audit_fields.sql`まで適用済みである。
- 移行中は旧Supabaseとproduction D1への書き込みを止め、完了またはrollbackまで再開しない。

`production`へマイグレーションを手元から適用するのは通常運用では行わない。Issue #124の移行で例外的に必要な場合は、[Cloudflare productionの構築・デプロイ・復旧](cloudflare-production-operations.md)に従い、理由、対象D1、commit SHA、時刻、結果をIssueへ記録する。

## 1. 移行元をバックアップして復旧できることを確かめる

```powershell
npm run prod:backup
npm run prod:restore -- "C:\Users\<you>\.yamoru\backups\prod\yamoru-prod-YYYYMMDD-HHMMSS.sql"
```

バックアップはリポジトリ外へ保存する。復旧確認では`auth.users`、`households`、`household_members`の件数と`orphan_count = 0`を確認する。実データの値は記録しない。確認後は案内されたコマンドで`environments/restore-verify`を停止する。

## 2. 移行前のproduction D1を保全する

production D1の現在bookmarkを取得し、出力と実行時刻をリポジトリ外の作業記録へ保存する。

```powershell
npx wrangler d1 time-travel info yamoru-production --env production --json
```

さらに移行前のschemaとデータをSQL exportとしてリポジトリ外へ保存する。`<backup-path>`には`%USERPROFILE%\.yamoru\backups\d1\`など、アクセスを制限した絶対パスを指定する。

```powershell
npx wrangler d1 export yamoru-production --remote --env production --output "<backup-path>\yamoru-production-before-data-migration.sql"
```

bookmarkとexportをIssueへ貼らない。exportが完了し、保存先を確認できるまで移行を進めない。

## 3. dry runで変換結果を確認する

```powershell
npm run data:migrate:dry-run
```

確認プロンプトへ`yamoru-production`を完全一致で入力する。このコマンドは移行元をread-onlyで抽出し、production D1を変更せず、次を検証する。

- production D1の`users`以外の移行対象tableが空である。
- production D1に、移行元に存在しないAuth.js利用者がいない。
- 主キーの重複と外部キー相当の参照切れがない。
- 変換後のtable別件数、既存Auth.js利用者との一致数、パスワードなしで新規作成する利用者数だけを表示する。

利用者はtrim・小文字化したemailで対応付ける。同じemailのAuth.js利用者が既にいればそのD1 user IDへ全参照を付け替える。存在しなければSupabase user ID、email、作成日時を保った`users`行を`password_hash = NULL`、`session_version = 0`で作る。Supabaseの認証情報はコピーしない。

主な変換契約は次のとおり。

| 移行元 | production D1での保持方法 |
|---|---|
| `household_members.id` | `household_members.source_id`へ保持し、家庭・利用者参照を維持する |
| `profiles.created_at` | `created_at`を保持し、`updated_at`の初期値にも使う |
| Todoと履歴 | ID、家庭、期限、担当、実行日時、次Occurrence、変更前後の期限・担当を保持し、UTC offsetだけをD1で比較可能な`Z`表記へ統一する |
| 招待 | token hash、作成・期限・受諾・取消・置換関係を保持し、状態を`accepted` / `cancelled` / `replaced` / `pending`へ変換する |
| 未消費claim | invitationへ紐づき、未消費かつ期限内のものだけを保持する |

dry runの件数が移行元の期待と一致しない、またはエラーになった場合はapplyしない。データを手修正して合わせず、移行コードまたはsourceの契約を見直す。

## 4. production D1へ一括適用する

```powershell
npm run data:migrate:production
```

確認プロンプトへ`yamoru-production`を完全一致で入力する。コマンドはdry runと同じ検証後、全INSERTを一つのD1 batchで実行する。完了条件は、表示された移行後件数が計画と一致し、`PRAGMA foreign_key_check`が0件であること。

D1 batchは一つのtransactionとして実行され、途中のstatementが失敗すればbatch全体がrollbackされる。ただし、完了後の意味的な誤りを自動で戻すものではない。

## 5. 認証と家庭間分離を確認する

`importedUsersWithoutPassword`に数がある場合、各利用者について次の管理コマンドを対話実行する。emailやパスワードを引数、Issue、ファイルへ書かない。

```powershell
npm run auth:reset-password:production
```

各利用者でログインし、次を確認する。

- ニックネーム、家庭、ManagedItem、Todo、期限、担当、履歴が移行前と一致する。
- 家庭の全メンバーは同じ家庭データを閲覧できる。
- 別家庭の利用者と非メンバーは、IDを直接指定しても対象家庭のデータを閲覧・更新・削除できない。
- 招待履歴の状態と置換関係が保たれている。

確認中にproduction D1へ新しい実データを入力しない。不一致があれば書き込み停止を維持し、次のrollback判断へ進む。

## 6. rollbackする

apply自体が失敗した場合は、まずtable別件数とD1の状態を再確認する。batchが失敗していれば部分INSERTは残らないため、原因を直すまで再実行しない。

apply完了後に重大な不一致が見つかった場合は、旧Supabaseを削除せず書き込み停止を維持する。Time Travelは移行後の正しい変更も失う破壊的操作なので、Issueへ影響と対象bookmarkを記録し、明示的な承認を得てから実行する。

```powershell
npx wrangler d1 time-travel restore yamoru-production --bookmark="<saved-bookmark>" --env production
```

復旧後は移行前exportと集計件数を使って状態を確認し、WorkerとD1 schemaの互換性も確認する。旧Supabaseを再び利用する場合は、切替時刻と書き込み再開先を一つに定め、二重書き込みを避ける。

## 参照

- [Cloudflare D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/) - batchのtransactionと失敗時rollback
- [Cloudflare D1 import / export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) - remote D1のSQL export
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) - bookmarkの取得とpoint-in-time restore
- [Auth.js初回bootstrapとパスワード再設定](auth-admin-operations.md) - passwordをログへ残さない再設定手順
- [旧Supabaseローカルprod環境の利用・運用手順](local-prod-operations.md) - 移行元backupとrestore確認
