"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { undoMaintenanceTaskCompletion } from "./actions";
import { formatTokyoDate } from "../../time-zone";

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
  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onCancel();
  }

  return (
    <div className="completion-dialog-backdrop" onMouseDown={handleBackdropClick}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="completion-dialog"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="completion-dialog-heading">
          <div>
            <p className="detail-kicker">UNDO</p>
            <h2 id={titleId}>{taskTitle}の完了を取り消す</h2>
          </div>
          <button aria-label="閉じる" className="dialog-close" onClick={onCancel} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </div>
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
      </section>
    </div>
  );
}

function UndoFeedback({
  errorMessage,
  isPending,
}: {
  errorMessage: string | null;
  isPending: boolean;
}) {
  return (
    <>
      {isPending ? (
        <p className="auth-feedback" role="status">
          取り消しています…
        </p>
      ) : null}
      {errorMessage !== null ? (
        <p className="auth-feedback" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
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
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleUndo() {
    setErrorMessage(null);
    setIsOpen(false);
    startTransition(async () => {
      const result = await undoMaintenanceTaskCompletion(
        managedItemId,
        occurrenceId,
        idempotencyKey,
      );
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  return (
    <div className="undo-completion-panel">
      <UndoTrigger
        onOpen={() => { setIsOpen(true); }}
        taskTitle={taskTitle}
        triggerRef={triggerRef}
      />
      {isOpen ? (
        <UndoConfirmDialog
          occurredAt={occurredAt}
          onCancel={closeDialog}
          onConfirm={handleUndo}
          taskTitle={taskTitle}
          titleId={titleId}
        />
      ) : null}
      <UndoFeedback errorMessage={errorMessage} isPending={isPending} />
    </div>
  );
}
