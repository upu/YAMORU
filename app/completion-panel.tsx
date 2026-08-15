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

import type { HouseholdMemberOption } from "../lib/supabase/profile";
import { formatDateInput } from "./time-zone";

type PanelView = "closed" | "choice" | "details";

type CompletionPanelProps = {
  // 完了ダイアログに「実施した人」として表示する名前。実データ画面では
  // ログイン中の利用者のニックネームを、デモ画面では固定の表示名を渡す。
  actorName: string;
  // 「詳しく記録する」の実施者選択で、既定値(自分)を判定するために使う。
  currentUserId: string;
  // 実施者選択の候補。同じ家庭のログイン済みメンバーに限る(YDR-020)。
  members: HouseholdMemberOption[];
  // occurredOn: null(現在時刻で完了)、string(実施日YYYY-MM-DD、今日以前を指定)。
  // performedByUserId: null(実施者=操作主体、既定)、string(選択した実施者のuser_id)。
  // 呼び出し側が「現在時刻」の決定方法(クライアント時刻かサーバー時刻か)を選べるよう、
  // このコンポーネント自身はDateを組み立てない。
  onComplete: (occurredOn: string | null, performedByUserId: string | null) => void;
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
        <span>実施した日・実施した人を変更</span>
      </button>
    </div>
  );
}

function CompletionDetails({
  currentUserId,
  dateInputRef,
  inputId,
  members,
  onBack,
  onSubmit,
  performerSelectId,
  today,
}: {
  currentUserId: string;
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  members: HouseholdMemberOption[];
  onBack: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  performerSelectId: string;
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
      {/* 担当者(AssigneePanel)とは別の概念であることが分かるよう、ラベルと
          位置を分ける(YDR-020「UIでの区別」)。既定値は現在の利用者で、
          変更した場合だけ操作主体と異なる実施者として記録される。 */}
      <label htmlFor={performerSelectId}>実施した人</label>
      <select
        defaultValue={currentUserId}
        id={performerSelectId}
        name="performedByUserId"
      >
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.nickname}
          </option>
        ))}
      </select>
      <p className="input-help">実際に作業した家庭のメンバーを選びます（既定は自分）</p>
      <button className="dialog-primary-button" type="submit">
        この内容で記録する
      </button>
    </form>
  );
}

// 「この内容で記録する」の送信内容を取り出す。実施日・実施した人のどちらかが
// 欠けていれば(ブラウザのバリデーションを回避された場合の防御)nullを返す。
function parseCompletionDetailsForm(
  formData: FormData,
): { occurredOn: string; performedByUserId: string } | null {
  const occurredOn = formData.get("occurredOn");
  const performedByUserId = formData.get("performedByUserId");
  if (typeof occurredOn !== "string" || occurredOn === "") return null;
  if (typeof performedByUserId !== "string" || performedByUserId === "") return null;
  return { occurredOn, performedByUserId };
}

type CompletionDialogProps = {
  actorName: string;
  currentUserId: string;
  dateInputRef: RefObject<HTMLInputElement | null>;
  inputId: string;
  members: HouseholdMemberOption[];
  onBack: () => void;
  onClose: () => void;
  onComplete: () => void;
  onShowDetails: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  performerSelectId: string;
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
            currentUserId={props.currentUserId}
            dateInputRef={props.dateInputRef}
            inputId={props.inputId}
            members={props.members}
            onBack={props.onBack}
            onSubmit={props.onSubmit}
            performerSelectId={props.performerSelectId}
            today={props.today}
          />
        )}
      </section>
    </div>
  );
}

export function CompletionPanel({
  actorName,
  currentUserId,
  members,
  onComplete,
  taskTitle,
}: CompletionPanelProps) {
  const [view, setView] = useState<PanelView>("closed");
  const titleId = useId();
  const inputId = useId();
  const performerSelectId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const quickCompleteRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const today = formatDateInput(new Date());

  useEffect(() => {
    if (view === "choice") quickCompleteRef.current?.focus();
    if (view === "details") dateInputRef.current?.focus();
  }, [view]);

  function submitDetails(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCompletionDetailsForm(new FormData(event.currentTarget));
    if (parsed === null) return;
    onComplete(parsed.occurredOn, parsed.performedByUserId);
    setView("closed");
  }

  return (
    <>
      <button aria-haspopup="dialog" aria-label={`${taskTitle}を記録`} className="completion-trigger" onClick={() => { setView("choice"); }} ref={triggerRef} type="button">
        やったよ
      </button>
      {view === "closed" ? null : (
        <CompletionDialog
          actorName={actorName}
          currentUserId={currentUserId}
          dateInputRef={dateInputRef}
          inputId={inputId}
          members={members}
          onBack={() => { setView("choice"); }}
          onClose={() => { setView("closed"); triggerRef.current?.focus(); }}
          onComplete={() => {
            // 追加入力なしの完了では、現在の利用者を実施者として記録する(Issue #18)。
            onComplete(null, null);
            setView("closed");
          }}
          onShowDetails={() => { setView("details"); }}
          onSubmit={submitDetails}
          performerSelectId={performerSelectId}
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
