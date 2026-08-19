---
type: Reference
title: 現在有効なRLSポリシー一覧
description: public スキーマの現在有効なRow Level Securityポリシーを、pg_policyとDBコメント(comment on policy)から一覧する自動生成カタログ
tags: [yamoru, supabase, database, rls]
status: stable
generated: true
---

<!--
  自動生成ファイル。手で編集しない(Issue #57)。

  supabase/migrations/を適用した使い捨てSupabaseスタックのpg_policyと
  comment on policyから `npm run gen:policies` で生成する。ポリシーを
  追加・変更したら再生成し、マイグレーションと同じコミットに含めること。
  ズレは `npm run gen:policies:check`(CIでも実行)が検出する。

  ポリシーの定義そのものの正本はsupabase/migrations/の各SQL、境界が実際に
  効いていることの正本はsupabase/tests/database/のpgTAPテストである。
  このカタログは「今どんなポリシーがあり、なぜあるか」の一覧に限る。
-->

# 現在有効なRLSポリシー一覧

| テーブル | ポリシー | 操作 | 対象ロール | 意図(comment on policy) |
|---|---|---|---|---|
| activity_logs | activity_logs_select_member | SELECT | authenticated | 家庭メンバー全員が同じ権限でTodo操作履歴(ActivityLog)を参照できる(Issue #34)。 |
| external_links | external_links_delete_member | DELETE | authenticated | 家庭メンバー全員が同じ権限で外部リンクを削除できる(Issue #33)。 |
| external_links | external_links_select_member | SELECT | authenticated | 家庭メンバー全員が同じ権限でManagedItemの外部リンクを参照できる(Issue #33)。 |
| external_links | external_links_update_member | UPDATE | authenticated | 家庭メンバー全員が同じ権限で外部リンクを更新できる。WITH CHECKで他家庭への付け替えを拒否する(Issue #33)。 |
| household_members | household_members_select_member | SELECT | authenticated | 自分が所属する家庭のmembership行だけ参照できる(Issue #14技術スパイク)。 |
| households | households_select_member | SELECT | authenticated | 自分が所属する家庭だけ参照できる。家庭間のデータ分離の起点(Issue #14技術スパイク)。 |
| managed_items | managed_items_delete_member | DELETE | authenticated | 家庭メンバー全員が同じ権限でManagedItemを削除できる(Issue #14技術スパイク)。 |
| managed_items | managed_items_select_member | SELECT | authenticated | 家庭メンバー全員が同じ権限でManagedItemを参照できる(YDR-005, Issue #14技術スパイク)。 |
| managed_items | managed_items_update_member | UPDATE | authenticated | 家庭メンバー全員が同じ権限でManagedItemを更新できる。WITH CHECKで他家庭のhousehold_idへの付け替えを拒否する(Issue #14技術スパイク)。 |
| profiles | profiles_insert_own | INSERT | authenticated | 自分のuser_idでのみプロフィール行を作成できる。他利用者のuser_idを指定した挿入はWITH CHECKで拒否する(Issue #30)。 |
| profiles | profiles_select_household_member | SELECT | authenticated | 呼び出し利用者と同じ家庭に属する利用者のニックネームを参照できる(Issue #36)。 |
| profiles | profiles_select_own | SELECT | authenticated | 自分のプロフィール行だけ参照できる。他利用者のニックネームはprofiles_select_household_memberが別途扱う(Issue #30)。 |
| profiles | profiles_update_own | UPDATE | authenticated | 自分のプロフィール行(ニックネーム)だけ更新できる。他利用者の行はUSING句で対象外になる(Issue #76)。 |
| task_occurrences | task_occurrences_select_member | SELECT | authenticated | 家庭メンバー全員が同じ権限でTodoの現在状態(TaskOccurrence)を参照できる(Issue #34)。 |
| task_rules | task_rules_select_member | SELECT | authenticated | 家庭メンバー全員が同じ権限でメンテナンスTodoの定義(TaskRule)を参照できる(Issue #34)。 |
