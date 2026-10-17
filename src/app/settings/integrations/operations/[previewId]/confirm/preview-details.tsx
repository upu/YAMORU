import { Fragment } from "react";

import styles from "./confirm.module.css";

// 外部commandのpreview(対象・差分・次回への影響)を、確認画面で読める形にする。
// 値はcommandごとに形が違うため、よく出る項目名だけを日本語にし、残りは
// そのまま示す。家庭内の名称やメモは利用者の入力なので、文字列として表示する。

const LABELS: Record<string, string> = {
  after: "変更後",
  applies_to: "適用範囲",
  assignee_id: "担当",
  before: "変更前",
  current_occurrence: "今回の予定",
  diff: "変更内容",
  due_at: "期限(日時)",
  due_on: "期限",
  first_occurrence: "初回の予定",
  following_occurrence: "次の予定",
  must_complete_by: "必達日",
  managed_item_id: "管理対象",
  name: "名前",
  next_after_completion: "完了後の次回",
  next_occurrence: "次回の予定",
  note: "メモ",
  occurred_at: "実施日時",
  occurred_on: "実施日",
  performer_id: "実施者",
  recurrence: "繰り返し",
  schedule_effect: "次回への影響",
  scheduled_for: "予定(日時)",
  scheduled_on: "予定日",
  status: "状態",
  title: "名前",
};

const KIND_LABELS: Record<string, string> = {
  attention_candidate: "通知候補",
  completion_log: "完了記録",
  consumable: "消耗品",
  managed_item: "管理対象",
  notification_settings: "通知設定",
  todo_occurrence: "Todo(今回)",
  todo_rule: "Todo",
};

function label(key: string): string {
  return LABELS[key] ?? key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isChange(value: Record<string, unknown>): boolean {
  return "from" in value && "to" in value && Object.keys(value).length === 2;
}

function List({ items }: { items: unknown[] }) {
  if (items.length === 0) return <>なし</>;
  return <>{items.map((item, index) => <span key={index}>{index > 0 ? "、" : ""}<Value value={item} /></span>)}</>;
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "未設定";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
}

function Value({ value }: { value: unknown }) {
  if (isRecord(value)) {
    return isChange(value) ? <><Value value={value.from} /> → <Value value={value.to} /></> : <Details value={value} />;
  }
  if (Array.isArray(value)) return <List items={value as unknown[]} />;
  return <>{scalarText(value)}</>;
}

function Details({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <>なし</>;
  return (
    <dl className={styles.details}>
      {entries.map(([key, item]) => (
        <Fragment key={key}>
          <dt>{label(key)}</dt>
          <dd><Value value={item} /></dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function PreviewDetails({ preview }: { preview: string }) {
  const parsed = JSON.parse(preview) as {
    affected_entities?: Record<string, unknown>[];
    diff?: Record<string, unknown>;
    schedule_effect?: Record<string, unknown>;
  };
  return (
    <>
      <h3>対象</h3>
      <ul className={styles.entities}>
        {(parsed.affected_entities ?? []).map((entity, index) => (
          <li key={index}>
            {typeof entity.title === "string" ? entity.title : "(名前なし)"}
            ({KIND_LABELS[String(entity.kind)] ?? String(entity.kind)})
          </li>
        ))}
      </ul>
      <h3>変更内容</h3>
      <Details value={parsed.diff ?? {}} />
      <h3>次回への影響</h3>
      <Details value={parsed.schedule_effect ?? {}} />
    </>
  );
}
