// Issue #240 / #244: 鉛筆アイコンだけの編集リンクに使う共通アイコン。
// アクセシブルな名前は、埋め込む側のLink要素のaria-labelで付ける
// (アイコン自体はaria-hiddenで読み上げない)。
export function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}
