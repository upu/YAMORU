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
import {
  setTaskOccurrenceSchedule,
  unsetTaskOccurrenceSchedule,
} from "./actions";

function ScheduleTrigger({
  onOpen,
  scheduledFor,
  taskTitle,
  triggerRef,
}: {
  onOpen: () => void;
  scheduledFor: string | null;
  taskTitle: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const isUndated = scheduledFor === null;
  return (
    <button
      aria-label={`${taskTitle}の予定日を${isUndated ? "設定する" : "未定に戻す"}`}
      className="postpone-trigger"
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      {isUndated ? "予定日を設定" : "予定日を未定に戻す"}
    </button>
  );
}

function ScheduleDialog({
  dateInputRef,
  inputId,
  isUndated,
  onCancel,
  onSubmit,
  onUnset,
  taskTitle,
  titleId,
}: {
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  isUndated: boolean;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  onUnset: () => void;
  taskTitle: string;
  titleId: string;
}) {
  const title = isUndated
    ? `${taskTitle}の予定日を設定`
    : `${taskTitle}の予定日を未定に戻す`;
  return (
    <DialogShell kicker="SCHEDULE" onClose={onCancel} title={title} titleId={titleId}>
      {isUndated ? (
        <form className="completion-detail-form" onSubmit={onSubmit}>
          <label htmlFor={inputId}>予定日</label>
          <input
            defaultValue={formatDateInput(new Date())}
            id={inputId}
            name="scheduledOn"
            ref={dateInputRef}
            required
            type="date"
          />
          <p className="input-help">
            予定日を設定すると、ホームの期限切れ・今日・近日へ日付に応じて表示されます。
          </p>
          <button className="dialog-primary-button" type="submit">
            この日を予定日にする
          </button>
        </form>
      ) : (
        <div className="completion-detail-form">
          <p>具体日を外し、ホームの「予定日未定」へ戻します。Todoや担当は削除されません。</p>
          <button className="dialog-primary-button" onClick={onUnset} type="button">
            予定日を未定に戻す
          </button>
        </div>
      )}
    </DialogShell>
  );
}

type SchedulePanelProps = {
  managedItemId: string | null;
  occurrenceId: string;
  scheduledFor: string | null;
  taskTitle: string;
};

export function SchedulePanel({
  managedItemId,
  occurrenceId,
  scheduledFor,
  taskTitle,
}: SchedulePanelProps) {
  const titleId = useId();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const dialog = useDialogAction(triggerRef);
  const { close, errorMessage, isOpen, isPending, open, run, successMessage } = dialog;
  const isUndated = scheduledFor === null;
  useEffect(() => { if (isOpen && isUndated) dateInputRef.current?.focus(); }, [isOpen, isUndated]);
  function submitSchedule(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const scheduledOn = new FormData(event.currentTarget).get("scheduledOn");
    if (typeof scheduledOn !== "string" || scheduledOn === "") return;
    run(() => setTaskOccurrenceSchedule(managedItemId, occurrenceId, scheduledOn), {
      showSuccessMessage: true,
    });
  }
  function unsetSchedule() {
    run(() => unsetTaskOccurrenceSchedule(managedItemId, occurrenceId), {
      showSuccessMessage: true,
    });
  }

  return (
    <div className="postpone-panel">
      <ScheduleTrigger
        onOpen={open}
        scheduledFor={scheduledFor}
        taskTitle={taskTitle}
        triggerRef={triggerRef}
      />
      {isOpen ? (
        <ScheduleDialog
          dateInputRef={dateInputRef}
          inputId={inputId}
          isUndated={isUndated}
          onCancel={close}
          onSubmit={submitSchedule}
          onUnset={unsetSchedule}
          taskTitle={taskTitle}
          titleId={titleId}
        />
      ) : null}
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="予定日を変更しています…"
        successMessage={successMessage}
      />
    </div>
  );
}
