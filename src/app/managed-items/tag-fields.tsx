import type { Tag } from "../../lib/d1/tags";
import { TAG_NAME_MAX_LENGTH } from "./tag-input";
import styles from "./tags.module.css";

// Issue #226 / YDR-048: 登録・編集フォームのタグ欄。大分類・詳しい種類とは
// 別の欄(fieldset)に置き、横断的な文脈の目印であることを分類と混ぜない。
// 家庭内の既存タグはチェックボックスで付け外しし、新しいタグはその場で
// 名前を書いて作る(同じ家庭に同名のタグがあれば、そのタグが付く)。
export function ManagedItemTagFields({
  idPrefix,
  selectedTagIds = [],
  tagOptions,
}: {
  idPrefix: string;
  selectedTagIds?: string[];
  tagOptions: Tag[];
}) {
  const selected = new Set(selectedTagIds);
  return (
    <fieldset aria-describedby={`${idPrefix}-tags-help`} className={styles.fieldset}>
      <legend>タグ（任意）</legend>
      <p id={`${idPrefix}-tags-help`}>
        「子どもA」「ペット」など、関係する人や場面でまとめる目印です。
      </p>
      {tagOptions.length === 0 ? null : (
        <ul className={styles.options}>
          {tagOptions.map((tag) => (
            <li key={tag.id}>
              <label className={styles.option}>
                <input
                  defaultChecked={selected.has(tag.id)}
                  name="tagIds"
                  type="checkbox"
                  value={tag.id}
                />
                <span>{tag.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${idPrefix}-new-tags`}>新しいタグ</label>
      <input
        aria-describedby={`${idPrefix}-new-tags-help`}
        autoComplete="off"
        id={`${idPrefix}-new-tags`}
        name="newTags"
        placeholder="例: 子どもA"
        type="text"
      />
      <p id={`${idPrefix}-new-tags-help`}>
        「、」で区切ると複数追加できます（1つ{TAG_NAME_MAX_LENGTH}文字まで）。
      </p>
    </fieldset>
  );
}
