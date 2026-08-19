---
type: Playbook
title: ローカルprod環境の利用・運用手順
description: 自分の家で実データを使ってYAMORUを動かす人向けに、初回セットアップから普段の起動、更新の取り込み、バックアップ・復旧までを一続きでまとめた手順書
tags: [yamoru, supabase, prod, operations]
status: stable
---

# ローカルprod環境の利用・運用手順

対象読者は、このリポジトリをcloneし、自分の家で実データを使ってYAMORUを動かす人。**この文書はスキーマを変更する手順を持たない。** マイグレーションを追加する、型やRLSポリシーカタログを再生成するなど、スキーマを変更する側の手順は[データベースに影響する変更の手順](database-change-playbook.md)を参照する。

## いつ読むか

- 初めてこのリポジトリをcloneし、ローカルprod環境をセットアップするとき
- 普段YAMORUを起動するとき
- `git pull`で更新を取り込んだあと、新しいマイグレーションがあるかどうかを確認したいとき
- prodのデータをバックアップ・復旧したいとき

## 1. 初回セットアップ

事前に[Docker Desktop](https://www.docker.com/products/docker-desktop/)を起動しておく。Supabase CLIは`devDependencies`に固定バージョンで含まれるため、追加インストールは不要。

```powershell
npm install
npm run prod:start
npm run prod:status
Copy-Item .env.example .env.local
```

`npm run prod:status`が表示するローカルの公開可能なキーを、`.env.local`の`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`へ設定する(CLIが`ANON_KEY`という名前で表示する場合も同じ値を使う)。Service Roleキーは設定しない。`npm run dev`(通常の開発サーバー)は常にこの`prod`環境へ接続する。

```powershell
npm run dev
```

[https://localhost:3000](https://localhost:3000)を開き、ログイン画面が表示されればセットアップは完了。スマートフォンなど同じLAN上の別端末から確認する場合は、READMEの[ローカルSupabase(prod・test環境)](../../README.md#ローカルsupabaseprodtest環境)にあるLAN内アクセス・ローカルCA信頼の手順を参照する。

## 2. 普段の起動

```powershell
npm run prod:start   # 既に起動していれば何もしない
npm run dev
```

## 3. 更新を取り込む

```powershell
git pull
```

`git pull`だけではSupabase側には何も反映されない。新しいマイグレーションが追加されていないかを、次の手順で確認する。

```powershell
npm run prod:start   # supabase/migrations/ の最新をenvironments/prod/へ同期する。起動済みでも安全に再実行できる
npx supabase migration list --local --workdir environments/prod
```

表示される`Local`列と`Remote`列を比較する。

- 全行で`Local`と`Remote`が一致していれば、未適用のマイグレーションはない。そのまま`npm run dev`で普段どおり起動してよい。
- `Local`列にだけ値があり`Remote`列が空の行があれば、その分だけ未適用のマイグレーションがある。次の手順でバックアップしてから取り込む。

```powershell
npm run prod:backup
npm run prod:migrate
```

`prod:migrate`は未適用のマイグレーションだけを、データを保ったまま適用する。適用後、再度`npx supabase migration list --local --workdir environments/prod`を実行し、全行が一致することを確認するとよい。

マイグレーションの内容そのもの(何が変わったか)を確認したい場合は、`supabase/migrations/`配下の新しいファイルを直接読むか、[データベースに影響する変更の手順](database-change-playbook.md)を参照する。

## 4. バックアップと復旧

```powershell
npm run prod:backup
```

- Auth利用者(`auth`スキーマ)とアプリのデータ(`public`スキーマ)をデータのみダンプし、リポジトリ外の既定の保存先(`%USERPROFILE%\.yamoru\backups\prod\`)へタイムスタンプ付きファイル名で保存する。保存先は環境変数`YAMORU_PROD_BACKUP_DIR`で変更できる。いずれもリポジトリの外であり、Gitの追跡対象にはならない。
- バックアップファイルには、パスワードハッシュやセッション・リフレッシュトークンを含むAuth利用者の認証情報と、家庭の実データが平文で含まれる。取扱いには実データそのものと同じ注意が必要。共有・アップロード先には十分注意し、不要になった世代は手動で削除する。
- ファイル名にタイムスタンプが付き世代管理されるため、最新の1件だけに依存しない。

復旧手順は、バックアップから別の一時スタック(`environments/restore-verify`、`prod`とは別のproject ID・ポート)へ復元し、内容を確認する形で検証する。

```powershell
npm run prod:restore -- "C:\Users\<you>\.yamoru\backups\prod\yamoru-prod-20260101-120000.sql"
```

一時スタックを起動してマイグレーションを適用し、指定したバックアップのデータを読み込んだうえで、Auth利用者・家庭・membershipの件数を表示する。Supabase StudioのURLも表示されるので、内容を目視でも確認できる。確認後は案内されるコマンドで一時スタックを停止する。

実際に`prod`のデータを失って復旧する場合だけ、確認用の環境変数を明示したうえで`prod`本体へ復元する。

```powershell
$env:YAMORU_CONFIRM_PROD_RESTORE = "YAMORU-prod-local"
npm run prod:restore -- "C:\Users\<you>\.yamoru\backups\prod\yamoru-prod-20260101-120000.sql" --target=prod
```

## 5. この文書で扱わないこと

- スキーマを変更する側の手順(マイグレーション追加、型・RLSポリシーカタログの再生成) → [データベースに影響する変更の手順](database-change-playbook.md)
- PWAとしての利用確認、LAN内アクセス・ローカルCA設定、`test`環境でのDBテスト → 引き続きREADMEを参照
- 新しいマイグレーション検知の自動化(通知やCLIコマンドの新設)。ここに書いたのは既存の仕組み(`supabase migration list`)による確認方法
- Hosted Supabase・Vercelなど、外部公開を前提にした運用手順。ローカルprod環境はあくまで個人用途

## 6. 参照

- [README - ローカルSupabase(prod・test環境)](../../README.md#ローカルsupabaseprodtest環境) - prod・testの物理的分離、LAN内アクセス、PWA、型生成・RLSポリシーカタログ生成
- [データベースに影響する変更の手順](database-change-playbook.md) - スキーマを変更する開発者向けの手順
- [現在有効なRLSポリシー一覧](rls-policy-catalog.md) - `pg_policy`と`comment on policy`から生成したRLSポリシーカタログ
