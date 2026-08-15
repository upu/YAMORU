"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// CompletionPanel・UndoCompletionPanel・PostponePanelが共通で使うダイアログの
// 外枠(背景クリック・Escapeでの閉じ方、見出し、閉じるボタン)。3箇所で同じ
// マークアップが重複していたため切り出す。中身(選択肢・確認文・フォームなど)
// は呼び出し側がchildrenとして渡す。
export function DialogShell({
  children,
  kicker,
  onClose,
  title,
  titleId,
}: {
  children: ReactNode;
  kicker: string;
  onClose: () => void;
  title: string;
  titleId: string;
}) {
  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div className="completion-dialog-backdrop" onMouseDown={handleBackdropClick}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="completion-dialog"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="completion-dialog-heading">
          <div>
            <p className="detail-kicker">{kicker}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button aria-label="閉じる" className="dialog-close" onClick={onClose} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
