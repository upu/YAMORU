"use client";

import { useActionState } from "react";

import { createOneTimeTodo } from "./actions";
import { INITIAL_TODO_STATE } from "./todo-state";

export type TodoManagedItemOption = { id: string; name: string };

export function TodoForm({
  managedItems,
}: {
  managedItems: TodoManagedItemOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    createOneTimeTodo,
    INITIAL_TODO_STATE,
  );

  return (
    <section aria-labelledby="todo-form-title" className="detail-card">
      <h2 id="todo-form-title">Todoを追加</h2>
      <form action={formAction} className="auth-form">
        <label htmlFor="home-todo-title">Todo名</label>
        <input
          autoComplete="off"
          id="home-todo-title"
          maxLength={100}
          name="title"
          placeholder="家族会議"
          required
          type="text"
        />

        <label htmlFor="home-todo-date">予定日</label>
        <input id="home-todo-date" name="plannedDate" required type="date" />

        <label htmlFor="home-todo-managed-item">関連する管理対象</label>
        <select defaultValue="" id="home-todo-managed-item" name="managedItemId">
          <option value="">なし</option>
          {managedItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <p className="input-help">今回は繰り返しなしで登録します。</p>

        <button className="auth-submit" disabled={isPending} type="submit">
          {isPending ? "登録しています…" : "Todoを追加"}
        </button>
        {state.status === "idle" ? null : (
          <p
            className={`auth-feedback${state.status === "success" ? " todo-success" : ""}`}
            role="status"
          >
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
