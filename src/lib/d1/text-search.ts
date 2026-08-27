// Issue #225: Todo一覧のフリーワード検索で導入し、Issue #218の台帳検索でも
// 同じ挙動を再利用する共通ヘルパー。LIKEの特殊文字(%, _)は検索語として
// 入力されても、ワイルドカードではなく文字通りの部分文字列として扱う
// (ESCAPE句で無害化)。SQLite標準のLOWER()はASCIIだけを小文字化するため、
// 大文字・小文字の違いは英数字部分にだけ影響し、日本語部分はもともと
// 大文字小文字の区別がないため挙動に影響しない。前後の空白・空文字は
// 絞り込みなしとして扱う(呼び出し側はnullを「絞り込みなし」として扱う)。
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// SQL側は `LOWER(column) LIKE ? ESCAPE '\'` の形で、この関数が返す値を
// そのままバインドする想定(呼び出し元のクエリー参照)。
export function likeSearchPattern(search: string | undefined): string | null {
  if (search === undefined) return null;
  const trimmed = search.trim();
  if (trimmed === "") return null;
  return `%${escapeLikePattern(trimmed.toLocaleLowerCase("ja-JP"))}%`;
}
