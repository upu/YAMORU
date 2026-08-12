---
type: Spike Report
title: Supabase RLSによる家庭間データ分離の技術スパイク
description: household_idとRow Level Securityだけで家庭Aと家庭Bのデータを分離できるかを、ローカルSupabaseとpgTAPで検証した
tags: [yamoru, spike, supabase, rls, security]
status: stable
---

# Supabase RLSによる家庭間データ分離の技術スパイク

Issue: [#14](https://github.com/upu/YAMORU/issues/14)
関連: [YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)(household_idとRLSによる家庭間分離を必須とする決定)

## 背景

YDR-005は、MVPでOwner/Memberなどの細かな権限区別を作らない一方、household_idとRLSによる家庭間のデータ分離を必須としている。Phase 2の本実装に進んでからRLSの構造上の問題が判明すると、テーブル設計や認証連携の手戻りが大きい。そのため、Phase 0の技術スパイクとして、最小スキーマで分離が成立するかを先に検証した。

## 検証方法

- ローカルSupabase(Docker、Supabase CLIはdevDependencyとして固定バージョンで導入)に、`households` / `household_members` / `managed_items`の最小スキーマをマイグレーションとして作成。
- 3テーブルすべてでRLSを有効化(`force row level security`込み)。
- `security definer`の`is_household_member(household_id)`関数で、認証済み利用者とmembership行の関係だけを根拠に判定するポリシーを作成(全員同権限、Owner/Member区別なし)。
- ローカル専用のfixture(家庭A・家庭Bと、それぞれのメンバー、非メンバーの認証済み利用者、テスト用managed_items)を`supabase/seed.sql`に用意。
- pgTAPテスト(`supabase/tests/database/household_rls_isolation.sql`)で、`authenticated`/`anon`ロールへの`set local role`と`request.jwt.claims`だけを使って(Service Roleは未使用)、以下を検証した。
  - 家庭Aのメンバーは家庭Aのmanaged_itemsを参照・作成・更新・削除できる
  - 家庭Aのメンバーは家庭Bのmanaged_itemsを参照・作成・更新・削除できない
  - 家庭Aのメンバーはhouseholds/household_membersでも自家庭分しか見えない
  - 非メンバー(認証済み・所属家庭なし)は家庭データを参照・作成できない
  - 未認証(anon)は家庭データを参照・作成できない

実装は`supabase/migrations/20260812055256_init_household_rls_spike.sql`、`supabase/seed.sql`、`supabase/tests/database/household_rls_isolation.sql`を参照。

## 結果

`npm run db:reset`(=`supabase db reset`)でマイグレーションとseedを最初から再構築できることを確認した。続けて`npm run db:test`(=`supabase test db`)を実行し、pgTAPテスト16件がすべて成功した(`Result: PASS`、`Tests=16`、失敗0件)。

| 受け入れ条件 | 結果 |
|---|---|
| `supabase db reset`でローカルDBを最初から再構築できる | 確認済み |
| 対象となる全テーブルでRLSが有効になっている | 確認済み(households/household_members/managed_itemsに`enable row level security`+`force row level security`) |
| 家庭Aのメンバーが家庭Aの管理対象を読み書きできる | 確認済み(参照・作成・更新・削除) |
| 家庭Aのメンバーが家庭Bの管理対象を読み書きできない | 確認済み(参照は0件、作成は権限エラー、更新・削除は対象0件) |
| 非メンバーと未認証利用者が家庭データを読み書きできない | 確認済み(非メンバーはRLSで0件、未認証はテーブル権限がなくエラー) |
| 上記の境界が自動化されたデータベーステストで確認される | 確認済み(`supabase/tests/database/household_rls_isolation.sql`、pgTAP、16 assertions) |
| テストがService RoleによるRLS回避に依存していない | 確認済み(`authenticated`/`anon`ロールと`request.jwt.claims`の模擬のみ使用、`service_role`は未使用) |
| スキーマとRLSポリシーがマイグレーションとして管理されている | 確認済み(`supabase/migrations/20260812055256_init_household_rls_spike.sql`) |
| 秘密情報や家庭の実データを含まない | 確認済み(fixtureはすべて架空の家庭A/B。ローカル専用キーのみ) |
| READMEの手順だけで必要条件とローカル検証方法が分かる | 確認済み(README「ローカルSupabase(技術スパイク)」参照) |
| スパイク結果と後続課題が文書に残っている | 本文書 |
| 既存の`npm run lint`/`typecheck`/`test`/`build`が成功する | 確認済み |

## 判明した制約・後続実装への注意点

- **membershipテーブル自身のRLSは再帰に注意する。** `household_members`テーブルのポリシーが`household_members`自身を参照すると無限再帰になる。`security definer`関数(所有者はRLSを回避するpostgresロール)経由で判定することで回避した。Phase 2でOwner/Member区別を導入する場合も、判定ロジックはこの関数パターンを踏襲する想定。
- **INSERT/UPDATEは`WITH CHECK`が必須。** `USING`だけでは、他家庭の`household_id`を付けた新規行の書き込みを防げない。クライアントが送る`household_id`を信用しない、という原則はテーブル定義ではなくポリシーの`WITH CHECK`で担保する。
- **UPDATE/DELETEの拒否は例外ではなく0件処理になる。** RLSの`USING`句で対象外の行は「エラー」ではなく「対象0件」として扱われる。アプリ側は、更新0件を「対象がそもそも他家庭のものだった」可能性として扱う必要がある(今回のテストでは`is_empty`で0件になることを確認する形にした)。
- **households / household_membersのINSERT/UPDATE/DELETEポリシーは未整備。** 今回はSELECTのみ。家庭作成・招待受諾のフロー(Phase 2、YDR-005の見直し条件外)を実装する段階で、誰が・どの条件で行を作成できるかを別途設計する必要がある。
- **Auth利用者の作成は`auth.users`への直接INSERTで代用した。** ローカルのGoTrue(Auth)サービス自体は起動しているが、サインアップ・ログイン画面やAuthプロバイダーの設定は技術スパイクの対象外のため未接続。テスト用利用者は`auth.users`へ直接INSERTして用意した。Phase 1でNext.jsからSupabase Authに接続する際、`auth.users`のスキーマ前提(このスパイクで使ったカラム)が変わらないか改めて確認する。
- **`is_household_member`は`search_path = ''`でハードニングした。** 本文は`public.household_members`/`auth.uid()`とすべて明示スキーマ修飾しているため、検索パス乗っ取りの余地をなくせる。Phase 2でこのパターンを流用する際も踏襲する。
- **`create extension pgtap`はマイグレーションに含めない。** テスト専用の拡張のため、リモート環境にも適用され得るマイグレーションチェーンではなく、`supabase/tests/database/household_rls_isolation.sql`側で`supabase test db`実行時にのみ有効化する構成にした。
- **`supabase test db`はService Roleを一切使わない構成で書けた。** `set local role authenticated / anon`と`request.jwt.claims`の模擬だけで、家庭A/B/非メンバー/未認証の4パターンをすべて検証できている。

## このスパイクで扱わなかったこと

Issueのスコープ外として、以下は未検証。

- リモートSupabaseプロジェクトでの動作
- Next.jsアプリからの実接続
- 招待トークンの発行・受諾フロー
- Owner/Memberなどの細かな権限区別
- TaskRule/TaskOccurrence/ActivityLogを含む本実装のスキーマ
- GitHub ActionsでのDBテスト自動実行
