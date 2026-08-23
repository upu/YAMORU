"use client";

import { type ChangeEvent, useState, useTransition } from "react";

import { claimTaskOccurrenceAssignee, setTaskOccurrenceAssignee } from "./actions";
import { OperationFeedback } from "../../operation-feedback";

const UNASSIGNED_VALUE = "";
// 「誰でも可」の表示文言(YDR-006)。担当者未設定の既定表示として、担当・実施・
// 操作主体のいずれとも異なるラベルにする(YDR-020「UIでの区別」)。
export const UNASSIGNED_LABEL = "誰でも可";

export type AssigneeOption = { nickname: string; userId: string };

// Issue #77: 未担当のときだけ表示する一操作の担当引き受けボタン。誰を担当に
// するかを選ぶ通常のselect(下記AssigneePanel)とは別に、「自分がやる」を
// 素早く伝える短い導線を提供する。対象は常に操作主体自身(サーバー側で決定、
// クライアントからは渡さない)。
function ClaimAssigneeTrigger({
  managedItemId,
  occurrenceId,
  taskTitle,
}: {
  managedItemId: string | null;
  occurrenceId: string;
  taskTitle: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleClaim() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await claimTaskOccurrenceAssignee(managedItemId, occurrenceId);
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  return (
    <>
      <button
        aria-label={`${taskTitle}を自分の担当にする`}
        className="claim-assignee-trigger"
        disabled={isPending}
        onClick={handleClaim}
        type="button"
      >
        やるよ
      </button>
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="担当にしています…"
      />
    </>
  );
}

function AssigneeOptions({ members }: { members: AssigneeOption[] }) {
  return (
    <>
      <option value={UNASSIGNED_VALUE}>{UNASSIGNED_LABEL}</option>
      {members.map((member) => (
        <option key={member.userId} value={member.userId}>
          {member.nickname}
        </option>
      ))}
    </>
  );
}

export function AssigneePanel({
  assigneeUserId,
  managedItemId,
  members,
  occurrenceId,
  taskTitle,
}: {
  assigneeUserId: string | null;
  managedItemId: string | null;
  members: AssigneeOption[];
  occurrenceId: string;
  taskTitle: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectId = `assignee-${occurrenceId}`;

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextAssigneeUserId =
      event.target.value === UNASSIGNED_VALUE ? null : event.target.value;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setTaskOccurrenceAssignee(
        managedItemId,
        occurrenceId,
        nextAssigneeUserId,
      );
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  return (
    <div className="assignee-panel">
      <label htmlFor={selectId}>{taskTitle}の担当</label>
      {/* 変更成功後は再検証で新しいassigneeUserIdが渡され、keyの変化でselectを
          作り直す。defaultValueだけでは既にマウント済みの要素に反映されないため
          (CompleteTodoPanelのidempotencyKeyコメントと同じ理由)。 */}
      <select
        defaultValue={assigneeUserId ?? UNASSIGNED_VALUE}
        disabled={isPending}
        id={selectId}
        key={assigneeUserId ?? UNASSIGNED_VALUE}
        onChange={handleChange}
      >
        <AssigneeOptions members={members} />
      </select>
      {assigneeUserId === null ? (
        <ClaimAssigneeTrigger
          managedItemId={managedItemId}
          occurrenceId={occurrenceId}
          taskTitle={taskTitle}
        />
      ) : null}
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="担当を変更しています…"
      />
    </div>
  );
}
