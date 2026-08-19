---
type: Playbook
title: データベースに影響する変更の手順
description: Supabaseのスキーマを変更するとき、または現在のスキーマを確認するときに、どこを正本として読み、どのコマンドを実行するかの手順
tags: [yamoru, supabase, database, migrations]
status: stable
---

# データベースに影響する変更の手順

Supabaseのスキーマに触れる作業の入口。**この文書はスキーマの内容を持たない。** テーブル定義の写しを手で書くと更新を忘れた時点で実装とずれるため、置くのは「どこを読み、何を実行するか」だけに限る([Issue #45](https://github.com/upu/YAMORU/issues/45))。

## いつ読むか

- 現在のテーブル・カラム・RPC関数の定義を確認したいとき
- `supabase/migrations/`へマイグレーションを追加するとき
- アプリコードから新しいテーブル・カラムを読み書きするとき

## 1. 現在のスキーマを確認する

| 知りたいこと | 正本 |
|---|---|
| テーブル、カラム、型、NULL可否、RPC関数の引数と戻り値 | `lib/supabase/database.types.ts` |
| 現在有効なRLSポリシーの一覧と、その意図(`comment on policy`由来) | `docs/references/rls-policy-catalog.md` |
| RLSポリシーの境界が実際に効いていること | `supabase/tests/database/`のpgTAPテスト |
| 変更の経緯 | `supabase/migrations/`の各SQL |

`lib/supabase/database.types.ts`はマイグレーションを積み上げた結果から生成された最終スキーマであり、全マイグレーションを時系列に読まなくても現在の姿が分かる。生成物なので手で編集しない。

**RLSポリシーは型に現れない。** 生成されるのはテーブルの形と関数のシグネチャだけで、「誰がどの行を読めるか」は含まれない。「今どんなポリシーがあり、なぜあるか」は`docs/references/rls-policy-catalog.md`(`pg_policy`と`comment on policy`から生成、Issue #57)で一覧できる。家庭間のデータ分離が実際に効いているかは、`supabase/tests/database/household_rls_isolation.sql`などのpgTAPテストが正本になる。ポリシーの定義そのものは各マイグレーションのSQLにある。

## 2. スキーマを変更する

1. `supabase/migrations/`へマイグレーションを追加する。ここが正本で、`environments/*/supabase/migrations/`は`scripts/supabase-env-sync.ts`が複製する派生物。
2. RLSに影響するなら、`supabase/tests/database/`へ境界を検証するpgTAPテストを追加する。ポリシーを追加・変更する場合は、`comment on policy ... is '...'`でその意図もDBコメントとして残す(手順4で再生成するカタログの入力になる)。
3. test環境へ適用して検証する。

   ```powershell
   npm run test:db:reset   # マイグレーションとseed.sqlを最初から再適用
   npm run test:db         # pgTAPテストを実行
   ```

4. 型とRLSポリシーカタログを再生成し、**マイグレーションと同じコミットに含める**。

   ```powershell
   npm run gen:types
   npm run gen:policies
   ```

5. アプリコード側のズレを検出する。テーブル名・カラム名・RPCの引数の誤りはここで落ちる。

   ```powershell
   npm run typecheck
   ```

6. 自分のprod環境にも反映する場合。

   ```powershell
   npm run prod:migrate
   ```

再生成を忘れた場合は、CIの`Supabase schema types are up to date`ジョブが失敗する。同じ検証はローカルでも`npm run gen:types:check`で実行できる。複数の作業を並行していて、後からマージされた側がrebaseした場合もこれで検出される。

RLSポリシーカタログも同様に、CIの`RLS policy catalog is up to date`ジョブ(ローカルでは`npm run gen:policies:check`)がズレを検出する。加えて、`comment on policy`を付け忘れたポリシーが1件でもあれば、内容のズレとは別の理由でこのジョブが失敗する。

型生成の仕組みそのもの(使い捨てスタックを使う理由、prod・testから生成しない理由)はREADMEの「スキーマの最新仕様(型生成)」に書いてある。RLSポリシーカタログも同じ理由・同じ方式で生成している。

## 3. この手順で行わないこと

- 適用済みマイグレーションの書き換え。スキーマを直す場合も新しいマイグレーションを追加する。
- 手で書いたスキーマ要約文書の追加。ズレを検知する仕組みを伴わない要約は置かない。
- `lib/supabase/database.types.ts`・`docs/references/rls-policy-catalog.md`の直接編集。どちらも生成物であり、スキーマ側(マイグレーションの`comment on policy`を含む)を直してから再生成する。

## 4. 参照

- [ローカルSupabase(prod・test環境)](../../README.md#ローカルsupabaseprodtest環境) - 環境の起動、型生成コマンドの詳細
- [ローカルprod環境の利用・運用手順](local-prod-operations.md) - `git pull`後の更新の取り込み、バックアップと復旧の手順
- [現在有効なRLSポリシー一覧](rls-policy-catalog.md) - `pg_policy`と`comment on policy`から生成したRLSポリシーカタログ
- [RLSスパイク結果](../spikes/supabase-rls-household-isolation.md) - 家庭間データ分離をRLSで実現できるかの検証
- [招待受諾スパイク結果](../spikes/household-invitation-acceptance.md) - 期限付き・一回限りの招待受諾とRLSの両立
- [YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md) - Realtimeと細かな権限区別をMVPで作らない
