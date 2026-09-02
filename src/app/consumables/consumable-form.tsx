"use client";

import { useActionState, useCallback, useState } from "react";
import { useFormStatus } from "react-dom";

import type {
  ConsumableDetail,
  ConsumableRelationOption,
  ConsumableTaskRuleOption,
} from "../../lib/d1/consumables";
import { createConsumable, updateConsumable } from "./actions";
import {
  searchConsumableManagedItems,
  searchConsumableTaskRules,
} from "./relation-actions";
import {
  ConsumableRelationField,
  describeManagedItem,
  describeTaskRule,
} from "./relation-picker";
import { INITIAL_CONSUMABLE_STATE } from "./state";

// Issue #311: 関連付けは消耗品詳細から操作するため、フォームは本体の
// 属性だけを受け取る。
type ConsumableFormData = Pick<
  ConsumableDetail,
  "externalUrl" | "id" | "name" | "note" | "productCode"
>;

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

function ConsumableFields({ consumable }: { consumable?: ConsumableFormData }) {
  return (
    <>
      <label htmlFor="consumable-name">名前</label>
      <input autoComplete="off" defaultValue={consumable?.name ?? ""}
        id="consumable-name" maxLength={100} name="name"
        placeholder="例: トイレットペーパー" required type="text" />

      <label htmlFor="consumable-product-code">型番・品番（任意）</label>
      <input autoComplete="off" defaultValue={consumable?.productCode ?? ""}
        id="consumable-product-code" maxLength={200} name="productCode"
        placeholder="例: FILTER-A" type="text" />

      <label htmlFor="consumable-external-url">外部リンク（任意）</label>
      <input autoComplete="url" defaultValue={consumable?.externalUrl ?? ""}
        id="consumable-external-url" maxLength={2048} name="externalUrl"
        placeholder="https://example.com/product" type="url" />

      <label htmlFor="consumable-note">メモ（任意）</label>
      <textarea defaultValue={consumable?.note ?? ""} id="consumable-note"
        maxLength={1000} name="note" placeholder="例: 予備は収納棚の上段" rows={4} />
    </>
  );
}

// Issue #292: 選択済みの関連だけをフォームへ表示し、追加は検索できる
// ダイアログから行う。Todoの候補は、選択済みの管理対象を手掛かりに
// 並べ替えるため、管理対象の選択が変わるたびに検索関数を作り直す。
// Issue #311: 登録のときだけ表示する。既存の消耗品の関連は詳細画面で扱う。
function ConsumableRelationFields({
  initialManagedItems,
}: {
  initialManagedItems: ConsumableRelationOption[];
}) {
  const [managedItems, setManagedItems] = useState(initialManagedItems);
  const [taskRules, setTaskRules] = useState<ConsumableTaskRuleOption[]>([]);
  const relatedIdsKey = managedItems.map((item) => item.id).join(",");
  const searchTaskRules = useCallback(
    (query: string) => searchConsumableTaskRules(
      query,
      relatedIdsKey === "" ? [] : relatedIdsKey.split(","),
    ),
    [relatedIdsKey],
  );

  return (
    <>
      <ConsumableRelationField
        describe={describeManagedItem}
        fieldName="managedItemIds"
        items={managedItems}
        onChange={setManagedItems}
        search={searchConsumableManagedItems}
        unit="管理対象"
      />
      <ConsumableRelationField
        describe={describeTaskRule}
        fieldName="taskRuleIds"
        items={taskRules}
        onChange={setTaskRules}
        search={searchTaskRules}
        unit="Todo"
      />
    </>
  );
}

// Issue #311: 登録時は詳細画面がまだ無いため、最初の関連もここで選べる。
// 既存の消耗品では関連の入口を詳細画面へ集約し、編集フォームは名前・型番・
// 外部リンク・メモという本体属性の編集に絞る。
function ConsumableRelationSection({
  initialManagedItem,
  mode,
}: {
  initialManagedItem?: ConsumableRelationOption;
  mode: "create" | "edit";
}) {
  if (mode === "edit") {
    return (
      <p className="input-help">
        関連する管理対象・Todoは、消耗品の詳細画面から追加・解除できます。
      </p>
    );
  }
  return (
    <>
      {/* 管理対象詳細から登録へ進んだ場合(#44)の初期選択を引き継ぐ。 */}
      <ConsumableRelationFields
        initialManagedItems={initialManagedItem === undefined ? [] : [initialManagedItem]}
      />
      <p className="input-help">
        どれにも関連付けず、家庭共通の消耗品として登録できます。
      </p>
    </>
  );
}

export function ConsumableForm({
  consumable,
  initialManagedItem,
  mode,
}: {
  consumable?: ConsumableFormData;
  initialManagedItem?: ConsumableRelationOption;
  mode: "create" | "edit";
}) {
  const action = mode === "create" ? createConsumable : updateConsumable;
  const [state, formAction] = useActionState(action, INITIAL_CONSUMABLE_STATE);

  return (
    <form action={formAction} className="auth-form consumable-form">
      {consumable === undefined ? null : (
        <input name="id" type="hidden" value={consumable.id} />
      )}

      <ConsumableFields consumable={consumable} />
      <ConsumableRelationSection initialManagedItem={initialManagedItem} mode={mode} />

      <SubmitButton mode={mode} />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}
