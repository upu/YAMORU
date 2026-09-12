"use client";

import {
  TASK_NOTE_MAX_LENGTH,
  TASK_NOTE_PLACEHOLDER,
} from "./todo-input-limits";

// Issue #329 / YDR-047: Todoの登録・編集で共通のメモ欄。手順・注意点・補足を
// 複数行のプレーンテキストで残す。Markdownやチェックリストは扱わない。
// 登録フォーム・1回だけ/必要時Todoの編集フォーム・繰り返しTodoのルール編集
// フォームが同じ部品を使い、名前(note)と上限・プレースホルダーを一致させる。

export function TodoNoteField({
  defaultValue = "",
  idPrefix,
}: {
  defaultValue?: string;
  idPrefix: string;
}) {
  const id = `${idPrefix}-note`;
  // 包みはOneTimeFieldsと同じ`todo-fieldset`。入力欄の間隔と余白を他の項目へ
  // そろえ、この欄のためのCSSを新しく足さない。
  return (
    <div className="todo-fieldset">
      <label htmlFor={id}>メモ(任意)</label>
      <textarea
        defaultValue={defaultValue}
        id={id}
        maxLength={TASK_NOTE_MAX_LENGTH}
        name="note"
        placeholder={TASK_NOTE_PLACEHOLDER}
        rows={4}
      />
      <p className="input-help">
        実施するときに確認したい手順や注意点を残せます。Todo詳細で確認できます。
      </p>
    </div>
  );
}
