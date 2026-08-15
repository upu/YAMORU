"use client";

import { useState, useTransition } from "react";

import type { HouseholdMemberOption } from "../../../lib/supabase/profile";
import { CompletionPanel } from "../../completion-panel";
import { OperationFeedback } from "../../operation-feedback";
import { completeMaintenanceTask } from "./actions";

export function CompleteTodoPanel({
  actorName,
  currentUserId,
  managedItemId,
  members,
  occurrenceId,
  taskTitle,
}: {
  actorName: string;
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
  occurrenceId: string;
  taskTitle: string;
}) {
  // occurrenceごとに一度だけ生成し、成功後は次回Occurrenceへの再検証で
  // このコンポーネントごと再マウントされることで新しいキーに切り替わる。
  // 正しさ自体はDB側の条件付き更新と冪等性キーで担保するため、二重クリックの
  // 抑止はCompletionPanelがダイアログを即座に閉じることだけに委ねる。
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleComplete(
    occurredOn: string | null,
    performedByUserId: string | null,
  ) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await completeMaintenanceTask(
        managedItemId,
        occurrenceId,
        idempotencyKey,
        occurredOn,
        performedByUserId,
      );
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  return (
    <div className="complete-todo-panel">
      <CompletionPanel
        actorName={actorName}
        currentUserId={currentUserId}
        members={members}
        onComplete={handleComplete}
        taskTitle={taskTitle}
      />
      <OperationFeedback
        errorMessage={errorMessage}
        isPending={isPending}
        pendingMessage="記録しています…"
      />
    </div>
  );
}
