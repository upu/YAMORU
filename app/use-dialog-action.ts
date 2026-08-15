"use client";

import { type RefObject, useState, useTransition } from "react";

type ActionResult = { message: string; status: string };

// UndoCompletionPanel・PostponePanelが共通で必要とする、確認ダイアログの
// 開閉と確定操作(サーバーアクション呼び出し)の進行状態・失敗フィードバックを
// まとめて管理する。開くたびに前回の失敗・成功表示をクリアし、閉じるときは
// トリガーへ焦点を戻す。
export function useDialogAction(triggerRef: RefObject<HTMLButtonElement | null>) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function open() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  // 呼び出し側が実行するサーバーアクションを渡す。成功時のメッセージは
  // 表示が必要な操作(延期)だけがshowSuccessMessage: trueを指定する
  // (取消のように成功フィードバックを表示しない操作は既定のfalseのままでよい)。
  function run<TResult extends ActionResult>(
    action: () => Promise<TResult>,
    options: { showSuccessMessage: boolean } = { showSuccessMessage: false },
  ) {
    setIsOpen(false);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setErrorMessage(result.message);
      } else if (options.showSuccessMessage) {
        setSuccessMessage(result.message);
      }
    });
  }

  return { close, errorMessage, isOpen, isPending, open, run, successMessage };
}
