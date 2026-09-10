"use client";

import Link from "next/link";
import { type RefObject, useCallback, useRef, useState, useTransition } from "react";

import type { ConsumableSummary } from "../../lib/d1/consumables";
import {
  searchConsumables,
  setConsumableTaskRuleRelation,
  type ConsumableRelationUpdateResult,
} from "./relation-actions";
import { RelationPickerDialog } from "./relation-picker";
import { StockStatusBadge } from "./stock-status";

const UNEXPECTED_ERROR_MESSAGE = "関連を更新できませんでした。時間をおいて再度お試しください。";

function describeConsumable(consumable: ConsumableSummary): string {
  return consumable.name;
}

function AddConsumableButton({
  onClick,
  triggerRef,
}: {
  onClick: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      aria-label="消耗品を追加"
      className="icon-button"
      onClick={onClick}
      ref={triggerRef}
      type="button"
    >
      <span aria-hidden="true">＋</span>
    </button>
  );
}

function ConsumableList({
  consumables,
  isSaving,
  onRemove,
}: {
  consumables: ConsumableSummary[];
  isSaving: boolean;
  onRemove?: (consumable: ConsumableSummary) => void;
}) {
  // Issue #395: 未選択であることは見出しと追加導線だけで分かる。同じ意味の
  // 空状態の行を重ねない(件数はsr-onlyのライブリージョンが伝える)。
  if (consumables.length === 0) return null;
  return (
    <ul className="ledger-list">
      {consumables.map((consumable) => (
        <li key={consumable.id}>
          <Link href={`/consumables/${encodeURIComponent(consumable.id)}`}>
            {consumable.name}
          </Link>
          <StockStatusBadge stockStatus={consumable.stockStatus} />
          {onRemove === undefined ? null : (
            <button
              aria-label={`${consumable.name}を関連から外す`}
              className="relation-chip-remove"
              disabled={isSaving}
              onClick={() => { onRemove(consumable); }}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function relationResult(
  consumableId: string,
  taskRuleId: string,
  related: boolean,
): Promise<ConsumableRelationUpdateResult> {
  return setConsumableTaskRuleRelation(consumableId, taskRuleId, related);
}

function updateConsumables(
  current: ConsumableSummary[],
  consumable: ConsumableSummary,
  related: boolean,
): ConsumableSummary[] {
  if (!related) return current.filter((item) => item.id !== consumable.id);
  return current.some((item) => item.id === consumable.id)
    ? current
    : [...current, consumable];
}

function useRelatedConsumables(
  initialConsumables: ConsumableSummary[],
  taskRuleId?: string,
) {
  const [consumables, setConsumables] = useState(initialConsumables);
  const [message, setMessage] = useState("");
  const [isSaving, startSaving] = useTransition();

  const save = useCallback((consumable: ConsumableSummary, related: boolean) => {
    if (taskRuleId === undefined) return;
    setMessage("");
    startSaving(async () => {
      let result: ConsumableRelationUpdateResult;
      try {
        result = await relationResult(consumable.id, taskRuleId, related);
      } catch {
        setMessage(UNEXPECTED_ERROR_MESSAGE);
        return;
      }
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setConsumables((current) => updateConsumables(current, consumable, related));
    });
  }, [taskRuleId]);

  return { consumables, isSaving, message, save };
}

function RelationHeading({
  addHref,
  onAdd,
  taskRuleId,
  triggerRef,
}: {
  addHref?: string;
  onAdd: () => void;
  taskRuleId?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="detail-section-heading">
      <h2 id="related-consumables-title">関連する消耗品</h2>
      {taskRuleId === undefined ? null : (
        <AddConsumableButton onClick={onAdd} triggerRef={triggerRef} />
      )}
      {addHref === undefined || taskRuleId !== undefined ? null : (
        <Link className="ledger-primary-link" href={addHref}>消耗品を追加</Link>
      )}
    </div>
  );
}

function RelationCount({ count }: { count: number }) {
  return (
    <p aria-live="polite" className="sr-only">
      関連する消耗品は{count}件です。
    </p>
  );
}

function EditorStatus({
  closePicker,
  consumables,
  isOpen,
  message,
  save,
}: {
  closePicker: () => void;
  consumables: ConsumableSummary[];
  isOpen: boolean;
  message: string;
  save: (consumable: ConsumableSummary, related: boolean) => void;
}) {
  const selectedIds = new Set(consumables.map((consumable) => consumable.id));
  return (
    <>
      <RelationCount count={consumables.length} />
      {message === "" ? null : (
        <p className="auth-feedback" role="alert">{message}</p>
      )}
      {isOpen ? (
        <RelationPickerDialog
          describe={describeConsumable}
          onClose={closePicker}
          onToggle={(consumable) => { save(consumable, !selectedIds.has(consumable.id)); }}
          search={searchConsumables}
          selectedIds={selectedIds}
          unit="消耗品"
        />
      ) : null}
    </>
  );
}

export function RelatedConsumablesSection({
  addHref,
  consumables: initialConsumables,
  taskRuleId,
}: {
  addHref?: string;
  consumables: ConsumableSummary[];
  taskRuleId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { consumables, isSaving, message, save } = useRelatedConsumables(
    initialConsumables,
    taskRuleId,
  );
  function closePicker() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }
  return (
    <section aria-labelledby="related-consumables-title" className="detail-card">
      <RelationHeading
        addHref={addHref}
        onAdd={() => { setIsOpen(true); }}
        taskRuleId={taskRuleId}
        triggerRef={triggerRef}
      />
      <ConsumableList
        consumables={consumables}
        isSaving={isSaving}
        onRemove={taskRuleId === undefined ? undefined : (consumable) => {
          save(consumable, false);
        }}
      />
      {taskRuleId === undefined ? (
        // 備品詳細では解除・追加をこの場で行わないため、件数だけを伝える。
        <RelationCount count={consumables.length} />
      ) : (
        <EditorStatus
          closePicker={closePicker}
          consumables={consumables}
          isOpen={isOpen}
          message={message}
          save={save}
        />
      )}
    </section>
  );
}
