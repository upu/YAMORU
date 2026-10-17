"use client";
import { useActionState } from "react";
import { HardDeadlineField } from "../../../app/todos/hard-deadline-field";
import { setTaskHardDeadline } from "../actions/hard-deadline";
import type { MaintenanceTodoActionState } from "../state";
import styles from "./hard-deadline-panel.module.css";

export function HardDeadlinePanel({ occurrenceId, managedItemId, value }: {
  occurrenceId: string; managedItemId: string | null; value: string | null;
}) {
  const [state, action, pending] = useActionState(async (_state: MaintenanceTodoActionState, data: FormData) => {
    const date = data.get("mustCompleteBy");
    if (typeof date !== "string") return { status: "error" as const, message: "必達日を正しく入力してください。" };
    return setTaskHardDeadline(managedItemId, occurrenceId, date, value);
  }, { status: "idle", message: "" } as MaintenanceTodoActionState);
  return (
    <details className={`detail-card ${styles.disclosure}`}>
      <summary>今回の必達日を設定・変更</summary>
      <form action={action} className="auth-form" aria-label="必達日の変更">
        <HardDeadlineField defaultValue={value ?? ""} />
        <button type="submit" disabled={pending} className="auth-submit">{pending ? "保存中…" : "必達日を保存"}</button>
        {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      </form>
    </details>
  );
}
