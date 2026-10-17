import type { Tag } from "../../lib/d1/tags";
import styles from "./tags.module.css";

// Issue #226 / YDR-048: 付与済みタグを、分類のバッジ(ClassificationBadges)とは
// 別の一覧として並べる。分類と見分けられるよう、色だけでなく「#」の印と
// 支援技術向けの「タグ: 」の読み上げを添える。タグがなければ何も出さない。
export function TagBadges({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="タグ" className={styles.badges}>
      {tags.map((tag) => (
        <li className={styles.badge} key={tag.id}>
          <span aria-hidden="true" className={styles.mark}>#</span>
          <span className="sr-only">タグ: </span>
          <span>{tag.name}</span>
        </li>
      ))}
    </ul>
  );
}
