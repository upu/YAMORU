"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_MAINTENANCE_TODO_STATE } from "../../../../features/todos/state";
import { type AssigneeOption, UNASSIGNED_LABEL } from "../../../assignee";
import {
  ManagedItemSearch,
  type TodoManagedItemOption,
} from "../../managed-item-search";
import { TodoNoteField } from "../../todo-note-field";
import { updateTodo } from "../actions";

export type TodoEditValues = {
  assigneeUserId: string | null;
  managedItemId: string | null;
  // Issue #329 / YDR-047: 保存済みのメモ。未設定は空文字で初期表示する。
  note: string;
  // Issue #325 / YDR-046: 「必要になったら繰り返す」Todoは予定日を持たない
  // 方式そのものなので、予定日欄を出さない。そのときだけnullを渡す。
  plannedDate: string | null;
  title: string;
};

export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "保存中…" : "変更を保存"}
    </button>
  );
}

function TitleAndScheduleFields({
  plannedDate,
  title,
}: Pick<TodoEditValues, "plannedDate" | "title">) {
  return (
    <>
      <label htmlFor="todo-edit-title">Todo名</label>
      <input
        autoComplete="off"
        defaultValue={title}
        id="todo-edit-title"
        maxLength={100}
        name="title"
        required
        type="text"
      />

      {plannedDate === null ? null : (
        <>
          <label htmlFor="todo-edit-planned-date">予定日</label>
          <input
            defaultValue={plannedDate}
            id="todo-edit-planned-date"
            name="plannedDate"
            type="date"
          />
          <p className="input-help">
            空欄にすると予定日は未定に戻ります。日付を入れると、その日に合わせてホームの期限切れ・今日・近日へ表示されます。
          </p>
        </>
      )}
    </>
  );
}

export function AssigneeField({
  assigneeUserId,
  members,
}: {
  assigneeUserId: string | null;
  members: AssigneeOption[];
}) {
  return (
    <>
      <label htmlFor="todo-edit-assignee">担当</label>
      <select
        defaultValue={assigneeUserId ?? ""}
        id="todo-edit-assignee"
        name="assigneeUserId"
      >
        <option value="">{UNASSIGNED_LABEL}</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.nickname}
          </option>
        ))}
      </select>
      <p className="input-help">
        担当を決めずに家族の誰でも対応できる状態にもできます。
      </p>
    </>
  );
}

// Issue #203: 繰り返しなしTodoの内容を1か所で編集する。現在の保存内容を初期値と
// して表示し、キャンセルでは保存せずTodo詳細へ戻る。対象のOccurrence IDは
// 隠しフィールドで渡し、actions.tsのupdateTodoが読み取る。
export function TodoEditForm({
  assigneeUserId,
  id,
  managedItemId,
  managedItems,
  members,
  note,
  plannedDate,
  title,
}: TodoEditValues & {
  id: string;
  managedItems: TodoManagedItemOption[];
  members: AssigneeOption[];
}) {
  const [state, formAction] = useActionState(
    updateTodo,
    INITIAL_MAINTENANCE_TODO_STATE,
  );

  return (
    <form aria-label="Todo編集フォーム" action={formAction} className="auth-form maintenance-todo-form">
      <input name="id" type="hidden" value={id} />

      <TitleAndScheduleFields plannedDate={plannedDate} title={title} />

      <AssigneeField assigneeUserId={assigneeUserId} members={members} />

      <TodoNoteField defaultValue={note} idPrefix="todo-edit" />

      <ManagedItemSearch
        idPrefix="todo-edit"
        initialManagedItemId={managedItemId}
        managedItems={managedItems}
      />

      <div className="nickname-edit-actions">
        <SubmitButton />
        <Link
          className="nickname-toggle-button"
          href={`/todos/${encodeURIComponent(id)}`}
        >
          キャンセル
        </Link>
      </div>
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}
