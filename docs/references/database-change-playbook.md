---
type: Playbook
title: データベースに影響する変更の手順
description: D1のスキーマ、データアクセス層、家庭間分離を変更するときの正本と確認手順
tags: [yamoru, cloudflare, d1, database, migrations, authorization]
status: stable
---

# データベースに影響する変更の手順

[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)に基づき、YAMORUのアプリデータはCloudflare D1を正本とする。D1にはRLSがないため、スキーマだけでなくデータアクセス関数と境界テストまでを一組として変更する。

## 現在の正本

| 知りたいこと | 正本 |
|---|---|
| テーブル、カラム、制約、索引 | `d1/migrations/` |
| household所属チェックと行単位の絞り込み | `lib/d1/` |
| 家庭A/B、非メンバー、未認証、IDOR、原子性 | `lib/d1/**/*.d1-test.ts` |
| 純粋な暦計算や画面actionの契約 | `tests/` |
| 変更の理由 | `docs/decisions/`のAcceptedなYDR |

`supabase/migrations/`、`lib/supabase/database.types.ts`、`docs/references/rls-policy-catalog.md`はD1移行前の履歴資料であり、現在のアプリデータ仕様の正本として使わない。Issue #122で置換する認証と招待受諾の互換経路だけは、移行完了までSupabaseを参照する。

## スキーマまたはデータアクセスを変更する

1. 適用済みファイルを書き換えず、`d1/migrations/`へ連番のマイグレーションを追加する。
2. すべての家庭データに`household_id`を持たせ、可能な箇所は複合外部キーで親子の家庭一致も制約する。
3. データアクセス関数はセッションからmembershipを導出する。フォームやURLから受け取ったhousehold IDを認可根拠にしない。
4. 読み書きのSQLへ`household_id`条件を含める。更新・削除では、家庭Aの正規セッションに家庭Bの行IDを組み合わせても0件またはNot Foundになることをテストする。
5. 完了記録、次回Occurrence生成、取り消し、招待再発行など複数行を変える処理は`D1Database.batch()`で一括実行し、途中の制約違反で部分状態が残らないテストを追加する。
6. 次の確認を実行する。

   ```powershell
   npm run d1:migrate
   npm run test:d1
   npm test
   npm run lint
   npm run build
   npm run typecheck
   ```

GitHub Actionsの`D1 migration and authorization tests`も、空のローカルD1へのマイグレーション適用とWorkersランタイム上のD1テストを実行する。

## 境界テストの最低条件

家庭データへ触れる主要操作では、少なくとも次を維持する。

- 家庭AのメンバーはAだけ、家庭BのメンバーはBだけを読み書きできる。
- 非メンバーと未認証の要求を拒否する。
- Aの正規セッションへBの行IDを渡しても、Bの行を読めず変更できない。
- 同時または途中失敗があり得る複数行更新は、全体成功または全体取り消しになる。
- 冪等性キーの再送は同じ結果を返し、別の対象への使い回しを拒否する。

## 関連資料

- [YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md) - Workers + D1とアプリ層認可の採用
- [YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md) - 招待限定アカウントと招待トークンの契約
- [Cloudflare Workers + D1スパイク](../spikes/cloudflare-workers-d1.md) - 採用前に確認した制約と比較
