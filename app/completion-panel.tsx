"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { formatDateInput } from "./time-zone";

type PanelView = "closed" | "choice" | "details";

type CompletionPanelProps = {
  // 完了ダイアログに「実施した人」として表示する名前。実データ画面では
  // ログイン中の利用者のニックネームを、デモ画面では固定の表示名を渡す。
  actorName: string;
  // null: 現在時刻で完了する。string: 実施日(YYYY-MM-DD、今日以前)を指定して完了する。
  // 呼び出し側が「現在時刻」の決定方法(クライアント時刻かサーバー時刻か)を選べるよう、
  // このコンポーネント自身はDateを組み立てない。
  onComplete: (occurredOn: string | null) => void;
  taskTitle: string;
};

function CompletionChoice({
  actorName,
  onComplete,
  onShowDetails,
  quickCompleteRef,
}: {
  actorName: string;
  onComplete: () => void;
  onShowDetails: () => void;
  quickCompleteRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="completion-choice-list">
      <p>どのように記録しますか？</p>
      <button
        aria-label="今、自分がやった"
        className="dialog-primary-button"
        onClick={onComplete}
        ref={quickCompleteRef}
        type="button"
      >
        <strong>今、自分がやった</strong>
        <span>現在の日付・{actorName}で記録</span>
      </button>
      <button
        aria-label="詳しく記録する"
        className="dialog-secondary-button"
        onClick={onShowDetails}
        type="button"
      >
        <strong>詳しく記録する</strong>
        <span>実施した日を変更</span>
      </button>
    </div>
  );
}

function CompletionDetails({
  actorName,
  dateInputRef,
  inputId,
  onBack,
  onSubmit,
  today,
}: {
  actorName: string;
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  onBack: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  today: string;
}) {
  return (
    <form className="completion-detail-form" onSubmit={onSubmit}>
      <button className="dialog-back-button" onClick={onBack} type="button">
        ← 選び方に戻る
      </button>
      <label htmlFor={inputId}>実施日</label>
      <input
        defaultValue={today}
        id={inputId}
        max={today}
        name="occurredOn"
        ref={dateInputRef}
        required
        type="date"
      />
      <p className="input-help">すでに実施した日を選びます（今日以前）</p>
      <div className="recording-summary">
        <span>実施した人</span>
        <strong>{actorName}</strong>
      </div>
      <button className="dialog-primary-button" type="submit">
        この内容で記録する
      </button>
    </form>
  );
}

type CompletionDialogProps = {
  actorName: string;
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  onBack: () => void;
  onClose: () => void;
  onComplete: () => void;
  onShowDetails: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  quickCompleteRef: RefObject<HTMLButtonElement | null>;
  taskTitle: string;
  titleId: string;
  today: string;
  view: Exclude<PanelView, "closed">;
};

function CompletionDialog(props: CompletionDialogProps) {
  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) props.onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") props.onClose();
  }

  return (
    <div className="completion-dialog-backdrop" onMouseDown={handleBackdropClick}>
      <section
        aria-labelledby={props.titleId}
        aria-modal="true"
        className="completion-dialog"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="completion-dialog-heading">
          <div>
            <p className="detail-kicker">ACTIVITY</p>
            <h2 id={props.titleId}>{props.taskTitle}を記録</h2>
          </div>
          <button aria-label="閉じる" className="dialog-close" onClick={props.onClose} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {props.view === "choice" ? (
          <CompletionChoice
            actorName={props.actorName}
            onComplete={props.onComplete}
            onShowDetails={props.onShowDetails}
            quickCompleteRef={props.quickCompleteRef}
          />
        ) : (
          <CompletionDetails
            actorName={props.actorName}
            dateInputRef={props.dateInputRef}
            inputId={props.inputId}
            onBack={props.onBack}
            onSubmit={props.onSubmit}
            today={props.today}
          />
        )}
      </section>
    </div>
  );
}

export function CompletionPanel({
  actorName,
  onComplete,
  taskTitle,
}: CompletionPanelProps) {
  const [view, setView] = useState<PanelView>("closed");
  const titleId = useId();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const quickCompleteRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const today = formatDateInput(new Date());

  useEffect(() => {
    if (view === "choice") quickCompleteRef.current?.focus();
    if (view === "details") dateInputRef.current?.focus();
  }, [view]);

  function closePanel() {
    setView("closed");
    triggerRef.current?.focus();
  }

  function completeNow() {
    onComplete(null);
    setView("closed");
  }

  function submitDetails(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const occurredOn = new FormData(event.currentTarget).get("occurredOn");
    if (typeof occurredOn === "string" && occurredOn !== "") {
      onComplete(occurredOn);
      setView("closed");
    }
  }

  return (
    <>
      <button aria-haspopup="dialog" aria-label={`${taskTitle}を記録`} className="completion-trigger" onClick={() => { setView("choice"); }} ref={triggerRef} type="button">
        やったよ
      </button>
      {view === "closed" ? null : (
        <CompletionDialog
          actorName={actorName}
          dateInputRef={dateInputRef}
          inputId={inputId}
          onBack={() => { setView("choice"); }}
          onClose={closePanel}
          onComplete={completeNow}
          onShowDetails={() => { setView("details"); }}
          onSubmit={submitDetails}
          quickCompleteRef={quickCompleteRef}
          taskTitle={taskTitle}
          titleId={titleId}
          today={today}
          view={view}
        />
      )}
    </>
  );
}
