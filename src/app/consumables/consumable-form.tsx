"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type {
  ConsumableDetail,
  ConsumableRelationOptions,
} from "../../lib/d1/consumables";
import { createConsumable, updateConsumable } from "./actions";
import { INITIAL_CONSUMABLE_STATE } from "./state";

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const idleLabel = mode === "create" ? "消耗品を登録" : "変更を保存";
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "保存中…" : idleLabel}
    </button>
  );
}

function TaskRuleLabel({
  managedItemName,
  title,
}: {
  managedItemName: string | null;
  title: string;
}) {
  return managedItemName === null ? title : `${title}（${managedItemName}）`;
}

export function ConsumableForm({
  consumable,
  initialManagedItemId,
  mode,
  options,
}: {
  consumable?: ConsumableDetail;
  initialManagedItemId?: string;
  mode: "create" | "edit";
  options: ConsumableRelationOptions;
}) {
  const action = mode === "create" ? createConsumable : updateConsumable;
  const [state, formAction] = useActionState(action, INITIAL_CONSUMABLE_STATE);
  const selectedManagedItems = new Set(
    consumable?.managedItems.map(({ id }) => id)
      ?? (initialManagedItemId === undefined ? [] : [initialManagedItemId]),
  );
  const selectedTaskRules = new Set(consumable?.taskRules.map(({ id }) => id) ?? []);

  return (
    <form action={formAction} className="auth-form consumable-form">
      {consumable === undefined ? null : (
        <input name="id" type="hidden" value={consumable.id} />
      )}

      <label htmlFor="consumable-name">名前</label>
      <input
        autoComplete="off"
        defaultValue={consumable?.name ?? ""}
        id="consumable-name"
        maxLength={100}
        name="name"
        placeholder="例: トイレットペーパー"
        required
        type="text"
      />

      <label htmlFor="consumable-product-code">型番・品番（任意）</label>
      <input
        autoComplete="off"
        defaultValue={consumable?.productCode ?? ""}
        id="consumable-product-code"
        maxLength={200}
        name="productCode"
        placeholder="例: FILTER-A"
        type="text"
      />

      <label htmlFor="consumable-external-url">外部リンク（任意）</label>
      <input
        autoComplete="url"
        defaultValue={consumable?.externalUrl ?? ""}
        id="consumable-external-url"
        maxLength={2048}
        name="externalUrl"
        placeholder="https://example.com/product"
        type="url"
      />

      <label htmlFor="consumable-note">メモ（任意）</label>
      <textarea
        defaultValue={consumable?.note ?? ""}
        id="consumable-note"
        maxLength={1000}
        name="note"
        placeholder="例: 予備は収納棚の上段"
        rows={4}
      />

      <fieldset className="consumable-relations">
        <legend>関連する管理対象（任意）</legend>
        {options.managedItems.length === 0 ? (
          <p className="input-help">関連付けられる管理対象はありません。</p>
        ) : (
          options.managedItems.map((item) => (
            <label className="filter-option" key={item.id}>
              <input
                defaultChecked={selectedManagedItems.has(item.id)}
                name="managedItemIds"
                type="checkbox"
                value={item.id}
              />
              <span>{item.name}</span>
            </label>
          ))
        )}
      </fieldset>

      <fieldset className="consumable-relations">
        <legend>関連するTodo（任意）</legend>
        {options.taskRules.length === 0 ? (
          <p className="input-help">関連付けられるメンテナンスTodoはありません。</p>
        ) : (
          options.taskRules.map((rule) => (
            <label className="filter-option" key={rule.id}>
              <input
                defaultChecked={selectedTaskRules.has(rule.id)}
                name="taskRuleIds"
                type="checkbox"
                value={rule.id}
              />
              <span>
                <TaskRuleLabel
                  managedItemName={rule.managedItemName}
                  title={rule.title}
                />
              </span>
            </label>
          ))
        )}
      </fieldset>

      <p className="input-help">
        どれにも関連付けず、家庭共通の消耗品として登録できます。
      </p>
      <SubmitButton mode={mode} />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}
