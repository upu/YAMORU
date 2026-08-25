"use client";

import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import type { HouseholdMemberOption } from "../../../lib/d1/profiles";
import { DialogShell } from "../../dialog-shell";
import { OperationFeedback } from "../../operation-feedback";
import { formatDateInput, formatTokyoDate } from "../../time-zone";
import {
  correctCompletionOccurredAt,
  correctCompletionPerformer,
  undoMaintenanceTaskCompletion,
} from "./actions";
import type { MaintenanceTodoActionState } from "./state";

type PanelView = "choice" | "closed" | "occurredAt" | "performer" | "undo";

function CorrectionTrigger({
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
      aria-label={`${taskTitle}を修正`}
      className="correction-trigger"
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      修正する
    </button>
  );
}

// Issue #148・#205: 完了済みTodo詳細の修正は、実施日時の訂正・実施者の訂正・
// 完了取消のいずれかを選ぶ入口。取消は既存のundoMaintenanceTaskCompletionを
// そのまま使う(YDR-015の仕組みを変えない)。訂正2つは新しい
// completion_correctionsへの追記になる(YDR-026)。
function CorrectionChoice({
  onSelectOccurredAt,
  onSelectPerformer,
  onSelectUndo,
}: {
  onSelectOccurredAt: () => void;
  onSelectPerformer: () => void;
  onSelectUndo: () => void;
}) {
  return (
    <div className="completion-choice-list">
      <p>何を修正しますか？</p>
      <button
        aria-label="実施日時を訂正する"
        className="dialog-primary-button"
        onClick={onSelectOccurredAt}
        type="button"
      >
        <strong>実施日時を訂正する</strong>
        <span>実施した日を変更します</span>
      </button>
      <button
        aria-label="実施者を訂正する"
        className="dialog-secondary-button"
        onClick={onSelectPerformer}
        type="button"
      >
        <strong>実施者を訂正する</strong>
        <span>実施した人を変更します</span>
      </button>
      <button
        aria-label="完了を取り消す"
        className="dialog-secondary-button"
        onClick={onSelectUndo}
        type="button"
      >
        <strong>完了を取り消す</strong>
        <span>未完了のTodoに戻します</span>
      </button>
    </div>
  );
}

function OccurredAtForm({
  dateInputRef,
  inputId,
  occurredAt,
  onBack,
  onSubmit,
}: {
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  occurredAt: string;
  onBack: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const today = formatDateInput(new Date());
  return (
    <form className="completion-detail-form" onSubmit={onSubmit}>
      <button className="dialog-back-button" onClick={onBack} type="button">
        ← 選び方に戻る
      </button>
      <label htmlFor={inputId}>実施日</label>
      <input
        defaultValue={formatDateInput(new Date(occurredAt))}
        id={inputId}
        max={today}
        name="occurredOn"
        ref={dateInputRef}
        required
        type="date"
      />
      <p className="input-help">正しい実施日を選びます（今日以前）</p>
      <button className="dialog-primary-button" type="submit">
        この日付で訂正する
      </button>
    </form>
  );
}

function PerformerForm({
  currentUserId,
  inputId,
  members,
  performedByUserId,
  onBack,
  onSubmit,
}: {
  currentUserId: string;
  inputId: string;
  members: HouseholdMemberOption[];
  performedByUserId: string | null;
  onBack: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="completion-detail-form" onSubmit={onSubmit}>
      <button className="dialog-back-button" onClick={onBack} type="button">
        ← 選び方に戻る
      </button>
      <label htmlFor={inputId}>実施した人</label>
      <select defaultValue={performedByUserId ?? currentUserId} id={inputId} name="performedByUserId">
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.nickname}
          </option>
        ))}
      </select>
      <p className="input-help">正しく実施した家庭のメンバーを選びます</p>
      <button className="dialog-primary-button" type="submit">
        この人で訂正する
      </button>
    </form>
  );
}

function UndoConfirm({
  occurredAt,
  onBack,
  onConfirm,
}: {
  occurredAt: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <p>
        {formatTokyoDate(occurredAt)}の完了を取り消します。未完了のTodoに戻り、次回の予定が作られている場合は未変更のものだけ削除されます。
      </p>
      <div className="completion-choice-list">
        <button className="dialog-primary-button" onClick={onConfirm} type="button">
          <strong>この完了を取り消す</strong>
        </button>
        <button className="dialog-secondary-button" onClick={onBack} type="button">
          <strong>選び方に戻る</strong>
        </button>
      </div>
    </>
  );
}

function parseFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : null;
}

type CorrectionDialogProps = {
  currentUserId: string;
  dateInputRef: RefObject<HTMLInputElement | null>;
  members: HouseholdMemberOption[];
  occurredAt: string;
  occurredAtInputId: string;
  onBack: () => void;
  onClose: () => void;
  onSelectOccurredAt: () => void;
  onSelectPerformer: () => void;
  onSelectUndo: () => void;
  onSubmitOccurredAt: (event: SyntheticEvent<HTMLFormElement>) => void;
  onSubmitPerformer: (event: SyntheticEvent<HTMLFormElement>) => void;
  onUndoConfirm: () => void;
  performedByUserId: string | null;
  performerSelectId: string;
  taskTitle: string;
  titleId: string;
  view: Exclude<PanelView, "closed">;
};

function CorrectionDialog(props: CorrectionDialogProps) {
  return (
    <DialogShell
      kicker="CORRECT"
      onClose={props.onClose}
      title={`${props.taskTitle}を修正`}
      titleId={props.titleId}
    >
      {props.view === "choice" ? (
        <CorrectionChoice
          onSelectOccurredAt={props.onSelectOccurredAt}
          onSelectPerformer={props.onSelectPerformer}
          onSelectUndo={props.onSelectUndo}
        />
      ) : null}
      {props.view === "occurredAt" ? (
        <OccurredAtForm
          dateInputRef={props.dateInputRef}
          inputId={props.occurredAtInputId}
          occurredAt={props.occurredAt}
          onBack={props.onBack}
          onSubmit={props.onSubmitOccurredAt}
        />
      ) : null}
      {props.view === "performer" ? (
        <PerformerForm
          currentUserId={props.currentUserId}
          inputId={props.performerSelectId}
          members={props.members}
          onBack={props.onBack}
          onSubmit={props.onSubmitPerformer}
          performedByUserId={props.performedByUserId}
        />
      ) : null}
      {props.view === "undo" ? (
        <UndoConfirm occurredAt={props.occurredAt} onBack={props.onBack} onConfirm={props.onUndoConfirm} />
      ) : null}
    </DialogShell>
  );
}

// CorrectionPanel本体を60行制限内へ収めるため、状態・ハンドラ一式を切り出す。
function useCorrectionPanelState(
  managedItemId: string | null,
  occurrenceId: string,
) {
  const [view, setView] = useState<PanelView>("closed");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === "occurredAt") dateInputRef.current?.focus();
  }, [view]);

  function open() {
    setErrorMessage(null);
    setIdempotencyKey(crypto.randomUUID());
    setView("choice");
  }

  function close() {
    setView("closed");
    triggerRef.current?.focus();
  }

  function runCorrection(action: () => Promise<MaintenanceTodoActionState>) {
    setView("closed");
    setErrorMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  function submitOccurredAt(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const occurredOn = parseFormValue(new FormData(event.currentTarget), "occurredOn");
    if (occurredOn === null) return;
    runCorrection(() => correctCompletionOccurredAt(managedItemId, occurrenceId, idempotencyKey, occurredOn));
  }

  function submitPerformer(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPerformerId = parseFormValue(new FormData(event.currentTarget), "performedByUserId");
    if (nextPerformerId === null) return;
    runCorrection(() => correctCompletionPerformer(managedItemId, occurrenceId, idempotencyKey, nextPerformerId));
  }

  function confirmUndo() {
    runCorrection(() => undoMaintenanceTaskCompletion(managedItemId, occurrenceId, idempotencyKey));
  }

  return {
    close,
    confirmUndo,
    dateInputRef,
    errorMessage,
    isPending,
    open,
    setView,
    submitOccurredAt,
    submitPerformer,
    triggerRef,
    view,
  };
}

// Issue #37の取消確認、#148の訂正2種を一つのダイアログへ統合する。正しさ自体は
// D1側の条件付き更新と冪等性キーで担保するため、連打の抑止はダイアログを
// 即座に閉じることだけに委ねる(CompletionPanel・PostponePanelと同じ方針)。
export function CorrectionPanel({
  currentUserId,
  managedItemId,
  members,
  occurredAt,
  occurrenceId,
  performedByUserId,
  taskTitle,
}: {
  currentUserId: string;
  managedItemId: string | null;
  members: HouseholdMemberOption[];
  occurredAt: string;
  occurrenceId: string;
  performedByUserId: string | null;
  taskTitle: string;
}) {
  const panel = useCorrectionPanelState(managedItemId, occurrenceId);
  const titleId = useId();
  const occurredAtInputId = useId();
  const performerSelectId = useId();

  return (
    <div className="correction-panel">
      <CorrectionTrigger onOpen={panel.open} taskTitle={taskTitle} triggerRef={panel.triggerRef} />
      {panel.view === "closed" ? null : (
        <CorrectionDialog
          currentUserId={currentUserId}
          dateInputRef={panel.dateInputRef}
          members={members}
          occurredAt={occurredAt}
          occurredAtInputId={occurredAtInputId}
          onBack={() => { panel.setView("choice"); }}
          onClose={panel.close}
          onSelectOccurredAt={() => { panel.setView("occurredAt"); }}
          onSelectPerformer={() => { panel.setView("performer"); }}
          onSelectUndo={() => { panel.setView("undo"); }}
          onSubmitOccurredAt={panel.submitOccurredAt}
          onSubmitPerformer={panel.submitPerformer}
          onUndoConfirm={panel.confirmUndo}
          performedByUserId={performedByUserId}
          performerSelectId={performerSelectId}
          taskTitle={taskTitle}
          titleId={titleId}
          view={panel.view}
        />
      )}
      <OperationFeedback
        errorMessage={panel.errorMessage}
        isPending={panel.isPending}
        pendingMessage="修正しています…"
      />
    </div>
  );
}
