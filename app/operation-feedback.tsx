// CompleteTodoPanel・AssigneePanel・UndoCompletionPanel・PostponePanelが共通で
// 使う、進行中・失敗・(任意で)成功のフィードバック表示。文言(pendingMessage)
// だけが操作ごとに異なるため、それを呼び出し側から渡す。
export function OperationFeedback({
  errorMessage,
  isPending,
  pendingMessage,
  successMessage = null,
}: {
  errorMessage: string | null;
  isPending: boolean;
  pendingMessage: string;
  successMessage?: string | null;
}) {
  return (
    <>
      {isPending ? (
        <p className="auth-feedback" role="status">
          {pendingMessage}
        </p>
      ) : null}
      {errorMessage !== null ? (
        <p className="auth-feedback" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {successMessage !== null ? (
        <p className="auth-feedback" role="status">
          {successMessage}
        </p>
      ) : null}
    </>
  );
}
