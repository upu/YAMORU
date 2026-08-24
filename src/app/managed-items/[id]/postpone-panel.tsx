"use client";

import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
} from "react";

import { DialogShell } from "../../dialog-shell";
import { OperationFeedback } from "../../operation-feedback";
import { formatDateInput } from "../../time-zone";
import { useDialogAction } from "../../use-dialog-action";
import { postponeTaskOccurrence } from "./actions";

// 完了記録の「実施日」(今日以前)とは逆に、翌日以降だけを選べるようにする。
// クライアント表示専用の既定値であり、サーバー側はnow()より後であることを
// 権威として検証する(CompletionPanelのtodayコメントと同じ理由)。
function tomorrowDateInput(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateInput(tomorrow);
}

// 「延期する日」の送信内容を取り出す。空文字の場合(ブラウザのバリデーションを
// 回避された場合の防御)はnullを返す。
function parsePostponeForm(formData: FormData): string | null {
  const dueOn = formData.get("dueOn");
  if (typeof dueOn !== "string" || dueOn === "") return null;
  return dueOn;
}

function PostponeTrigger({
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
      aria-label={`${taskTitle}を延期する`}
      className="postpone-trigger"
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      延期する
    </button>
  );
}

function PostponeDialog({
  dateInputRef,
  inputId,
  min,
  onCancel,
  onSubmit,
  taskTitle,
  titleId,
}: {
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  min: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  taskTitle: string;
  titleId: string;
}) {
  return (
    <DialogShell kicker="POSTPONE" onClose={onCancel} title={`${taskTitle}を延期`} titleId={titleId}>
      {/* バックデート完了の「実施日」(過去の記録)と混同しないよう、ここでは
          まだ実施していない未完了Todoの現在期限だけを未来へ動かす操作である
          ことが分かる文言にする(YDR-020「UIでの区別」、Issue #19)。本来の
          予定(scheduled_for)は変えない。 */}
      <form className="completion-detail-form" onSubmit={onSubmit}>
        <label htmlFor={inputId}>実施する予定の新しい期限</label>
        <input
          defaultValue={min}
          id={inputId}
          min={min}
          name="dueOn"
          ref={dateInputRef}
          required
          type="date"
        />
        <p className="input-help">
          まだ実施していないTodoの期限を、これから実施する未来の日へ動かします（明日以降）。本来の予定日は変わりません。
        </p>
        <button className="dialog-primary-button" type="submit">
          この日まで延期する
        </button>
      </form>
    </DialogShell>
  );
}

// Issue #19: 未完了Todoから、実施する予定の未来日を指定して延期する。完了記録の
// 「詳しく記録する」(過去の実施を記録する)とは別の入口にする(案1、設計メモ参照)。
export function PostponePanel({
  managedItemId,
  occurrenceId,
  taskTitle,
}: {
  managedItemId: string;
  occurrenceId: string;
  taskTitle: string;
}) {
  const titleId = useId();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const min = tomorrowDateInput();
  const { close, errorMessage, isOpen, isPending, open, run, successMessage } =
    useDialogAction(triggerRef);

  useEffect(() => {
    if (isOpen) dateInputRef.current?.focus();
  }, [isOpen]);

  function submitPostpone(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const dueOn = parsePostponeForm(new FormData(event.currentTarget));
    if (dueOn === null) return;
    run(() => postponeTaskOccurrence(managedItemId, occurrenceId, dueOn), {
      showSuccessMessage: true,
    });
  }

  return (
    <div className="postpone-panel">
      <PostponeTrigger onOpen={open} taskTitle={taskTitle} triggerRef={triggerRef} />
      {isOpen ? (
        <PostponeDialog
          dateInputRef={dateInputRef}
          inputId={inputId}
          min={min}
          onCancel={close}
          onSubmit={submitPostpone}
          taskTitle={taskTitle}
          titleId={titleId}
        />
      ) : null}
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="延期しています…"
        successMessage={successMessage}
      />
    </div>
  );
}
