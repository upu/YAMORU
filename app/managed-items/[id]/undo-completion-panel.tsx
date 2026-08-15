"use client";

import { type RefObject, useId, useRef, useState } from "react";

import { undoMaintenanceTaskCompletion } from "./actions";
import { DialogShell } from "../../dialog-shell";
import { OperationFeedback } from "../../operation-feedback";
import { formatTokyoDate } from "../../time-zone";
import { useDialogAction } from "../../use-dialog-action";

function UndoTrigger({
  onOpen,
  taskTitle,
  triggerRef,
}: {
  onOpen: () => void;
  taskTitle: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      aria-label={`${taskTitle}の完了を取り消す`}
      className="undo-trigger"
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      取り消す
    </button>
  );
}

type UndoConfirmDialogProps = {
  occurredAt: string;
  onCancel: () => void;
  onConfirm: () => void;
  taskTitle: string;
  titleId: string;
};

function UndoConfirmDialog({
  occurredAt,
  onCancel,
  onConfirm,
  taskTitle,
  titleId,
}: UndoConfirmDialogProps) {
  return (
    <DialogShell
      kicker="UNDO"
      onClose={onCancel}
      title={`${taskTitle}の完了を取り消す`}
      titleId={titleId}
    >
      <p>
        {formatTokyoDate(occurredAt)}の完了を取り消します。未完了のTodoに戻り、自動生成された次回の予定は削除されます。
      </p>
      <div className="completion-choice-list">
        <button className="dialog-primary-button" onClick={onConfirm} type="button">
          <strong>この完了を取り消す</strong>
        </button>
        <button className="dialog-secondary-button" onClick={onCancel} type="button">
          <strong>やめる</strong>
        </button>
      </div>
    </DialogShell>
  );
}

// Issue #37: 取消対象・影響・実行後の状態が分かる確認ダイアログを経由してから
// RPCを呼ぶ。正しさ自体はDB側の条件付き更新と冪等性キーで担保するため、
// 連打の抑止はダイアログを即座に閉じることだけに委ねる(#35のCompleteTodoPanelと同じ方針)。
export function UndoCompletionPanel({
  managedItemId,
  occurredAt,
  occurrenceId,
  taskTitle,
}: {
  managedItemId: string;
  occurredAt: string;
  occurrenceId: string;
  taskTitle: string;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { close, errorMessage, isOpen, isPending, open, run } =
    useDialogAction(triggerRef);

  function handleUndo() {
    run(() => undoMaintenanceTaskCompletion(managedItemId, occurrenceId, idempotencyKey));
  }

  return (
    <div className="undo-completion-panel">
      <UndoTrigger onOpen={open} taskTitle={taskTitle} triggerRef={triggerRef} />
      {isOpen ? (
        <UndoConfirmDialog
          occurredAt={occurredAt}
          onCancel={close}
          onConfirm={handleUndo}
          taskTitle={taskTitle}
          titleId={titleId}
        />
      ) : null}
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="取り消しています…"
      />
    </div>
  );
}
