"use client";

import { useState, useTransition } from "react";

import { CompletionPanel } from "../../completion-panel";
import { completeMaintenanceTask } from "./actions";

export function CompleteTodoPanel({
  managedItemId,
  occurrenceId,
  taskTitle,
}: {
  managedItemId: string;
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

  function handleComplete(occurredOn: string | null) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await completeMaintenanceTask(
        managedItemId,
        occurrenceId,
        idempotencyKey,
        occurredOn,
      );
      if (result.status === "error") setErrorMessage(result.message);
    });
  }

  return (
    <div className="complete-todo-panel">
      <CompletionPanel onComplete={handleComplete} taskTitle={taskTitle} />
      {isPending ? (
        <p className="auth-feedback" role="status">
          記録しています…
        </p>
      ) : null}
      {errorMessage !== null ? (
        <p className="auth-feedback" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
