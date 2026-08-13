---
type: Decision
ydr_id: YDR-020
title: 担当者・実施者・操作主体を区別し、保存先を固定する
description: TaskOccurrenceの担当者、ActivityLog完了履歴の実施者、常にauth.uid()から決まる操作主体を別概念として定義し、データモデルと既存ActivityLogの移行方針を定める
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-14
---

# YDR-020: 担当者・実施者・操作主体を区別し、保存先を固定する

- 状態: Accepted
- 決定日: 2026-08-14

## 背景

現在の`activity_logs.actor_user_id`は、アプリを操作した認証利用者という意味で使われている(`supabase/migrations/20260813153000_complete_maintenance_task.sql`で`auth.uid()`から`acting_user_id`として決定し、クライアントからは受け取らない)。一方、Phase 2では次の3つを区別する必要がある。

- 担当者: Todoを事前に引き受けた人([YDR-006](ydr-006-unassigned-by-default.md)で「担当者未設定を既定にする」「TaskRuleには既定担当者を持たせず、担当はTaskOccurrence単位の任意項目にする」とすでに決めている)
- 実施者: 完了時に実際に作業した人。YDR-006は「実際に完了した人は履歴へ記録する」としているが、操作主体と同一のカラムに記録するのか、別概念として持つのかは未定義のまま残っていた
- 操作主体: アプリを操作した認証済み利用者。`activity_logs.actor_user_id`が既に担っている

[#18](https://github.com/upu/YAMORU/issues/18)(実施者選択)、[#19](https://github.com/upu/YAMORU/issues/19)(延期)、[#72](https://github.com/upu/YAMORU/issues/72)(担当者選択UI、本Issueの対象外)はいずれもこの区別を前提にしており、個別実装で暗黙に決めると実装ごとに異なる前提が生まれる。担当設定、完了、延期、取消、履歴表示に横断的に影響するため、実装より先に固定する。

## 決定

### 三つの概念の意味と保存先

| 概念 | 意味 | 保存先 | 決定方法 |
|---|---|---|---|
| 担当者(assignee) | Todoを事前に引き受けた人。未設定は「誰でも可」([YDR-006](ydr-006-unassigned-by-default.md)) | `task_occurrences.assignee_user_id`(新規、nullable) | 利用者が任意に設定・変更する |
| 実施者(performer) | 完了時に実際に作業した人 | `activity_logs.performed_by_user_id`(新規、nullable)。`action = 'completed'`の行にのみ意味を持つ | 既定は操作主体。「詳しく記録する」を使った場合だけ利用者が変更する |
| 操作主体(actor) | アプリを操作した認証済み利用者 | `activity_logs.actor_user_id`(既存) | 常に`auth.uid()`から決定する。クライアントは指定できない |

担当者、実施者、操作主体はいずれも利用者を指すが、同じ値になるとは限らない(例: 操作主体が家族Bの完了操作で、担当者は家族A、実施者は同じ家庭のログイン済みメンバーである家族Cの場合がありうる。実施者に選べる範囲は下記「実施者(performer)の既定値と範囲」を参照)。

### 操作主体(actor)の決定方法

- `activity_logs.actor_user_id`は、常にDB関数内で`auth.uid()`から決定する。クライアントからのパラメータとして受け取らない。`complete_maintenance_task`は既にこの方式であり、本決定はこの既存実装を踏襲し、今後追加する延期・担当変更などのDB関数にも同じ制約を課す。
- 未認証(`auth.uid()`が`null`)の呼び出しは、操作主体を決定できないため拒否する(`complete_maintenance_task`の既存の`Authentication required`エラーと同様)。

### 実施者(performer)の既定値と範囲

- 完了時に追加入力がなければ、実施者は操作主体と同じ値になる。DB関数は`performed_by_user_id`引数を省略可能とし、省略時は`auth.uid()`を使う。
- 「詳しく記録する」を使った場合だけ、実施者を操作主体と異なる人に変更できる。
- 実施者として選べるのは、同じ家庭に所属するログイン済み利用者に限る([#18](https://github.com/upu/YAMORU/issues/18)のPhase 2境界)。DB関数側は、まず呼出側(`auth.uid()`)から対象Occurrenceの`household_id`を確定し、その家庭の`household_members`に対してのみ`performed_by_user_id`の所属を検証する。全家庭を横断して利用者の存在を検索しない。
- 実施者の検証に失敗する理由(指定IDが存在しない、他家庭に所属している、対象家庭のメンバーではないなど)は区別せず、常に同一のエラーを返す。失敗理由によって応答内容や有無を変えると、他家庭の利用者の存在や所属を推測させるオラクルになる([YDR-019](ydr-019-invitation-lifecycle.md)「受諾エラーの扱い」と同じ、失敗理由を推測させない原則を踏襲する)。
- 同一の`idempotency_key`を、保存済みと異なる`performed_by_user_id`で再送した場合は、`complete_maintenance_task`が既に持つOccurrence不一致時のエラー(`Idempotency key was already used for a different occurrence`)と同様に「異なる内容の再送」として拒否する。保存済みの値を黙って優先して返さない。
- ログインアカウントを持たない家族(子どもなど)を実施者として記録する人物台帳は、本YDRの対象外とする(Issueの「このIssueでは行わないこと」に明記)。
- 実施者の概念は完了(`action = 'completed'`)にのみ適用する。延期・取消・担当変更などの操作には実施者という概念がなく、`performed_by_user_id`は`null`のままにする。延期の操作履歴には操作主体と操作日時だけを記録し、実施者は記録しない([#19](https://github.com/upu/YAMORU/issues/19)のPhase 2境界と一致)。
- 実施者の記録は、お手伝いの記録や引き継ぎのためであり、実施量の集計・ランキング・ポイント化には使わない([#18](https://github.com/upu/YAMORU/issues/18))。

### 担当者(assignee)の扱い

- `task_occurrences.assignee_user_id`はTaskOccurrence単位の任意項目とし、未設定(`null`)を既定の「誰でも可」とする([YDR-006](ydr-006-unassigned-by-default.md)を変更せず、保存先を具体化するもの)。
- TaskRuleには既定担当者を持たせない([YDR-006](ydr-006-unassigned-by-default.md)を維持)。
- 完了によって自動生成される次回Occurrenceは、担当者を未設定(`null`)で作る。完了時の担当者を次回へ引き継がない。担当の割り当てが催促や責任追及として受け取られることを避けるという[YDR-006](ydr-006-unassigned-by-default.md)の背景と整合させるための明示であり、担当者を自動的にコピーする実装は本決定に反する。
- 担当変更は追記型のActivityLog(`action = 'assignee_changed'`。既存の`activity_logs_action_check`制約で予約済みの値であり、新しいaction名は追加しない)として記録する。担当変更の実施者概念はなく、操作主体だけを記録する。
- TaskOccurrenceは現在の担当者しか保持しないため、変更後の担当者(解除の場合はその旨)をActivityLog側からも復元できることを要件とする。具体的な保存カラムは実装Issue([#72](https://github.com/upu/YAMORU/issues/72))で定める。
- 担当変更は、対象Occurrenceが`pending`である場合に限り許可し、Occurrenceの更新とActivityLogへの追記を一トランザクションで行う([YDR-014](ydr-014-unique-constraints-and-conditional-update.md)の条件付き更新パターンを踏襲する)。この制約は、下記「既存YDRとの整合」でのYDR-015に対する主張(担当変更のActivityLogが完了取消の防止条件になる)を成立させるために必要である。

### データモデル上の制約

- `task_occurrences.assignee_user_id`と`activity_logs.performed_by_user_id`は、既存の`activity_logs_actor_household_fkey`(`(household_id, actor_user_id)` → `household_members(household_id, user_id)`)と同じ形の複合外部キーを持たせ、`household_id`を含めて同じ家庭のメンバーに制限する。単独の`user_id`外部キーは使わない。
- `action = 'completed'`の行でのみ`performed_by_user_id`が非nullになるという不変条件は、アプリ層の合意だけでなくCHECK制約として強制する(例: `(action = 'completed') = (performed_by_user_id is not null)`)。将来のDB関数の不具合によって不変条件が破られた行が作られることを防ぐ。

### UIでの区別

- 担当者、実施者、操作主体は、UI上で異なるラベル・表示位置を用い、混同しない([#18](https://github.com/upu/YAMORU/issues/18)の受け入れ基準)。具体的な文言やレイアウトは実装Issueで定める。

### 既存ActivityLogの移行方針

- `activity_logs.performed_by_user_id`を追加する時点で、既存の完了履歴(`action = 'completed'`)は、`performed_by_user_id = actor_user_id`としてバックフィルする(実施者=操作主体として移行する)。
- 完了以外の既存行(`completion_undone`など)は`performed_by_user_id`を`null`のままとする。
- 移行後も恒常的な不変条件として、`action = 'completed'`の行は常に`performed_by_user_id`が設定され、それ以外の`action`の行は`performed_by_user_id`が常に`null`である。上記「データモデル上の制約」のCHECK制約で強制されるため、履歴表示はこの不変条件に依存してよい。

### 既存YDRとの整合

- [YDR-006](ydr-006-unassigned-by-default.md): 「担当者未設定を既定にする」「実際に完了した人は履歴へ記録する」という決定を変更しない。本YDRは、その担当者の保存先(`task_occurrences.assignee_user_id`)と、「実際に完了した人」が操作主体と同一カラムではなく別概念(実施者)であることを具体化するものである。
- [YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md): `performed_by_user_id`の追加は、ActivityLogが追記型履歴でTaskOccurrenceが現在状態であるという整理、および完了取消のトランザクション構成を変更しない。次回Occurrenceへの担当変更(`assignee_changed`)は、上記「担当者(assignee)の扱い」で定めるOccurrence更新とActivityLog追記の同時トランザクションによって初めて、YDR-015が定める「次回Occurrenceに利用者操作のActivityLogが一つでもある場合、取消を拒否する」の対象に確実に含まれる。本YDRによる新しい例外は設けない。

## 結果

- Phase 2の実装(担当設定、完了、延期、取消、履歴表示)は本YDRの契約に従う。
- `task_occurrences.assignee_user_id`と`activity_logs.performed_by_user_id`の2カラム、および`(action = 'completed') = (performed_by_user_id is not null)`のCHECK制約がスキーマに必要になり、既存の`activity_logs_actor_household_fkey`と同じ形の複合外部キーを追加する。担当変更の変更後の値を保存するカラムは実装Issue([#72](https://github.com/upu/YAMORU/issues/72))で追加する。
- `complete_maintenance_task`は、任意の`performed_by_user_id`引数を受け取り、同じ家庭のログイン済みメンバーであることを検証したうえで`activity_logs.performed_by_user_id`へ保存するよう拡張が必要になる。省略時は`auth.uid()`を使う。検証失敗の理由は区別せず、同一idempotency_keyでの実施者不一致は再送エラーとして扱う。
- 既存の完了履歴は`performed_by_user_id = actor_user_id`としてバックフィルする。
- 担当変更を扱う新しいDB関数は、`pending`のOccurrenceに対してのみ、Occurrence更新とActivityLog追記を一トランザクションで行う。
- 担当者・実施者選択UIの実装は本YDRの対象外とし、別Issueで扱う。

## 見直す条件

- ログインアカウントを持たない家族(子どもなど)の人物台帳を導入する。その時点で実施者・担当者の選択肢をログイン済み家庭メンバーに限定する前提を再設計する。
- Owner / Memberなど役割区別を導入する。その時点で担当者・実施者の変更権限([YDR-005](ydr-005-no-realtime-no-fine-grained-permissions.md)の「家庭メンバー全員が編集可能」)を再確認する。
- 複数家庭対応を導入する。その時点でhousehold_idを含む複合外部キー制約の前提を再設計する。
- 家事ランキング、ポイント、家族評価を導入する。その時点で実施者記録を評価目的に使わないという原則を再確認する。
