# Decisions

各意思決定(YDR)を1件ずつのOKF `type: Decision`文書として管理する。この索引が、現在有効な意思決定へたどるための正本である。

## Reading rules

- `Accepted`であり、後続のYDRに`superseded_by`で置き換えられていない判断だけを現在有効として扱う。
- `Superseded`の判断は、現在の仕様ではなく過去の経緯として扱う。各文書のフロントマターにある`supersedes`/`superseded_by`から置き換え関係をたどる。
- 各文書の`status`(OKF上のライフサイクル状態)と、`decision_status`(Accepted / Superseded)は別の情報である。混同しない。

## 一覧

| ID | 決定 | 状態 | 文書 |
|---|---|---|---|
| YDR-001 | まず家族専用として作る | Accepted | [ydr-001-family-first.md](ydr-001-family-first.md) |
| YDR-002 | Phase 1に最小限の管理対象を残す | Accepted | [ydr-002-minimal-managed-item.md](ydr-002-minimal-managed-item.md) |
| YDR-003 | MVPから在庫・添付・支払い・買い替えを外す | Accepted | [ydr-003-defer-inventory-attachments-payments-replacement.md](ydr-003-defer-inventory-attachments-payments-replacement.md) |
| YDR-004 | バックデート完了と完了取消をMVPに含める | Accepted | [ydr-004-backdate-and-undo-completion.md](ydr-004-backdate-and-undo-completion.md) |
| YDR-005 | Realtimeと細かな権限区別をMVPで作らない | Superseded by YDR-022(household_idとRLS必須の部分のみ) | [ydr-005-no-realtime-no-fine-grained-permissions.md](ydr-005-no-realtime-no-fine-grained-permissions.md) |
| YDR-006 | 担当者未設定を既定にする | Accepted | [ydr-006-unassigned-by-default.md](ydr-006-unassigned-by-default.md) |
| YDR-007 | 通知を長期間実機検証し、結果だけでネイティブ化しない | Superseded by YDR-009 | [ydr-007-notification-field-trial.md](ydr-007-notification-field-trial.md) |
| YDR-008 | AIを正しさの基盤にしない | Accepted | [ydr-008-ai-not-source-of-truth.md](ydr-008-ai-not-source-of-truth.md) |
| YDR-009 | 初期版から通知機能を外し、ホーム画面へ集約する | Accepted | [ydr-009-drop-notifications-consolidate-home.md](ydr-009-drop-notifications-consolidate-home.md) |
| YDR-010 | MVPではTaskRuleごとに未解決Todoを最大1件とする | Superseded by YDR-017 | [ydr-010-single-pending-occurrence-per-task-rule.md](ydr-010-single-pending-occurrence-per-task-rule.md) |
| YDR-011 | 開封履歴を蓄積せず、最終利用日時だけを任意で保持する | Accepted | [ydr-011-last-seen-only-no-open-history.md](ydr-011-last-seen-only-no-open-history.md) |
| YDR-012 | 実施日時と記録日時、本来の予定と現在期限を分離する | Accepted | [ydr-012-separate-occurred-recorded-scheduled-due.md](ydr-012-separate-occurred-recorded-scheduled-due.md) |
| YDR-013 | 固定日基準の次回予定枠を元の予定と実際の解決日時から決める | Accepted | [ydr-013-fixed-date-next-occurrence-calculation.md](ydr-013-fixed-date-next-occurrence-calculation.md) |
| YDR-014 | 二種類の一意制約と条件付き更新で重複完了を防ぐ | Accepted | [ydr-014-unique-constraints-and-conditional-update.md](ydr-014-unique-constraints-and-conditional-update.md) |
| YDR-015 | Occurrenceを状態、ActivityLogを履歴とし、安全な条件で完了取消する | Accepted | [ydr-015-occurrence-state-activitylog-history-safe-undo.md](ydr-015-occurrence-state-activitylog-history-safe-undo.md) |
| YDR-016 | 「回ごとに残す」方式の導入時に過去分を自動生成しない | Accepted | [ydr-016-no-backfill-on-per-occurrence-mode.md](ydr-016-no-backfill-on-per-occurrence-mode.md) |
| YDR-017 | 厳密な期限とメンテナンスの推奨期間を区別する | Superseded by YDR-027(推奨期間内の開始条件の部分のみ) | [ydr-017-strict-deadline-vs-maintenance-recommended-window.md](ydr-017-strict-deadline-vs-maintenance-recommended-window.md) |
| YDR-018 | アカウント単位のニックネームを家庭内Member表示名と同一概念として扱う | Accepted | [ydr-018-account-nickname-as-member-display-name.md](ydr-018-account-nickname-as-member-display-name.md) |
| YDR-019 | 家族招待の発行・受諾・失効ライフサイクルを固定する | Superseded by YDR-023 | [ydr-019-invitation-lifecycle.md](ydr-019-invitation-lifecycle.md) |
| YDR-020 | 担当者・実施者・操作主体を区別し、保存先を固定する | Accepted | [ydr-020-assignee-performer-actor.md](ydr-020-assignee-performer-actor.md) |
| YDR-021 | 定例日基準Todoの暦規則とタイムゾーンを固定する | Accepted | [ydr-021-recurring-calendar-rules.md](ydr-021-recurring-calendar-rules.md) |
| YDR-022 | Cloudflare Workers + D1へ移行し、家庭間分離をアプリ層で実装する | Accepted | [ydr-022-cloudflare-workers-d1-migration.md](ydr-022-cloudflare-workers-d1-migration.md) |
| YDR-023 | 公開登録を閉じ、招待限定のアカウント作成と最小のパスワード運用を採用する | Superseded by YDR-024(招待token搬送方式の部分のみ) | [ydr-023-invitation-only-account-lifecycle.md](ydr-023-invitation-only-account-lifecycle.md) |
| YDR-024 | 招待の生tokenをquery stringではなくURL fragmentで搬送する | Accepted | [ydr-024-invitation-token-in-url-fragment.md](ydr-024-invitation-token-in-url-fragment.md) |
| YDR-025 | PBKDF2の反復回数をCloudflare Workersの実行上限(10万回)に合わせる | Accepted | [ydr-025-pbkdf2-iterations-within-workers-limit.md](ydr-025-pbkdf2-iterations-within-workers-limit.md) |
| YDR-026 | 実施記録の訂正を追記型の訂正イベントとして記録し、有効値を読み取り時に解決する | Accepted | [ydr-026-completion-correction-events.md](ydr-026-completion-correction-events.md) |
| YDR-027 | メンテナンス推奨期間の「そろそろ」表示を進捗率80%から開始する | Superseded by YDR-034(80%しきい値を維持した4状態化) | [ydr-027-maintenance-reminder-progress-ratio.md](ydr-027-maintenance-reminder-progress-ratio.md) |
| YDR-028 | ManagedItemの大分類、詳しい種類、タグの役割を分離する | Superseded by YDR-029(初期の表示ラベルの部分のみ) | [ydr-028-managed-item-kind-item-type-tags.md](ydr-028-managed-item-kind-item-type-tags.md) |
| YDR-029 | 大分類の表示ラベルを登録時に選びやすい短い表現へ揃える | Superseded by YDR-035 | [ydr-029-managed-item-kind-labels.md](ydr-029-managed-item-kind-labels.md) |
| YDR-030 | 一回限りTodoだけ予定日未定のOccurrenceを許す | Superseded by YDR-031(ホーム表示先の部分のみ) | [ydr-030-undated-one-time-task-occurrences.md](ydr-030-undated-one-time-task-occurrences.md) |
| YDR-031 | 予定日未定Todoをホームの要対応表示から外し、Todo一覧で扱う | Accepted | [ydr-031-undated-todos-out-of-home.md](ydr-031-undated-todos-out-of-home.md) |
| YDR-032 | 毎月の定例日指定に「月末」を固定日1〜31とは別の意味として追加する | Accepted | [ydr-032-monthly-day-month-end.md](ydr-032-monthly-day-month-end.md) |
| YDR-033 | ManagedItemの開始時期をstarted_onへ段階移行し、大分類ごとの言葉で表示する | Accepted | [ydr-033-managed-item-started-on.md](ydr-033-managed-item-started-on.md) |
| YDR-034 | メンテナンスTodoを推奨期間の進み具合に応じた4状態でホームへ表示する | Accepted | [ydr-034-maintenance-home-progress-states.md](ydr-034-maintenance-home-progress-states.md) |
| YDR-035 | ManagedItemの大分類を備品、サービス、支払い・手続きの3択にする | Accepted | [ydr-035-retire-other-managed-item-kind.md](ydr-035-retire-other-managed-item-kind.md) |

## 新しい意思決定の追加

新しいYDRは、この一覧への追記と、対応する個別ファイルの追加を同じ変更内で行う。既存のAcceptedな判断を変更する場合は、新しいYDRを追加し、置き換え元と置き換え先の双方に`supersedes`/`superseded_by`を設定する。
