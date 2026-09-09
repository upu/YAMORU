// Issue #375 / #361: ホームへのピン留めを表す共通アイコン。消耗品詳細の
// ピン留めボタンと、ヘルプの「主なアイコン」で同じ図形を使う。
// アクセシブルな名前は埋め込む側で付ける(アイコン自体は読み上げない)。
export function PinIcon({ isPinned }: { isPinned: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M8 3h8l-1 6 3 3v2h-5v7l-1 1-1-1v-7H6v-2l3-3Z"
        fill={isPinned ? "currentColor" : "none"}
      />
    </svg>
  );
}
