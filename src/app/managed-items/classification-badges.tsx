// 大分類と詳しい種類はYDR-028で別の概念として分離している。連結した一つの
// 文字列にせず、それぞれ独立したバッジとして並べる(Issue #195)。
// 見分けを色だけに委ねないよう、各バッジは分類の呼び名をテキストとして持つ。
export function ClassificationBadges({
  itemTypeLabel,
  kindLabel,
}: {
  itemTypeLabel: string | null;
  kindLabel: string;
}) {
  return (
    <ul aria-label="分類" className="classification-badges">
      <li className="classification-badge classification-badge-kind">
        <span className="sr-only">大分類: </span>
        <span>{kindLabel}</span>
      </li>
      {itemTypeLabel === null ? null : (
        <li className="classification-badge classification-badge-item-type">
          <span className="sr-only">詳しい種類: </span>
          <span>{itemTypeLabel}</span>
        </li>
      )}
    </ul>
  );
}
