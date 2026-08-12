---
type: Decision
ydr_id: YDR-010
title: MVPではTaskRuleごとに未解決Todoを最大1件とする
description: 未完了時の扱いを「1件を持ち越す」方式に絞り、TaskRuleごとの未解決Occurrenceを最大1件にする
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Superseded
decision_date: 2026-08-12
superseded_by: YDR-017
---

# YDR-010: MVPではTaskRuleごとに未解決Todoを最大1件とする

- 状態: Superseded by [YDR-017](ydr-017-strict-deadline-vs-maintenance-recommended-window.md)(「未完了なら期限切れのまま表示する」という表示前提のみ置き換え。未解決Occurrenceを最大1件とする決定そのものは[YDR-017](ydr-017-strict-deadline-vs-maintenance-recommended-window.md)でも維持される)
- 決定日: 2026-08-12

## 背景

掃除やメンテナンスでは、7月分を実施しないまま8月になっても、7月分と8月分を別々に並べる必要は薄い。未完了の1件を期限切れとして持ち越す方が、画面が散らからず、日次cronや大量の未来Occurrenceも不要になる。

一方、月謝や固定資産税の各期などは、7月分を遅れて支払っても8月分が別に必要である。この違いは、周期の基準とは別の「未完了時の扱い」として整理する。

## 決定

- 未完了時の扱いを「1件を持ち越す」と「回ごとに残す」の二種類として設計する。
- MVPは「1件を持ち越す」だけを実装する。
- TaskRuleごとに未解決のTaskOccurrenceを最大1件とする。
- 未完了なら古いOccurrenceを期限切れのまま表示し、新しい回を追加しない。
- 完了、または将来追加する固定日基準のスキップで解決したときに、次のOccurrenceを生成する。
- 固定日基準の具体的な次回予定枠計算は[YDR-013](ydr-013-fixed-date-next-occurrence-calculation.md)に従う。
- 完了日基準では、実施日時から次回を計算する。家族共有MVP（Phase 2まで）ではスキップを提供せず、Phase 3で固定日基準のスキップだけを追加する。
- 「回ごとに残す」は、支払い機能を追加するPhase 6で実装する。

## 結果

- MVPではTaskOccurrence生成用のCronを使用しない。
- 期限切れが複数回分に増殖しない。
- 月謝や税金の各回を残す要件を、将来機能として失わない。

## 見直す条件

- 掃除やメンテナンスでも、未実施だった各回を個別に残す必要が実運用から確認された。
- 支払い機能の設計に着手する。

この決定のうち「未完了なら期限切れのまま表示する」という表示前提は、メンテナンスの推奨期間を区別する[YDR-017](ydr-017-strict-deadline-vs-maintenance-recommended-window.md)によって置き換えられた。未解決Occurrenceを最大1件とする決定自体は変更されていないため、記録は削除しない。
