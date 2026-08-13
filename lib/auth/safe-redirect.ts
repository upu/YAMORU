// ログイン・新規登録・ニックネーム登録の完了後に戻る先(next)を検証する。
// 外部ドメインへ誘導するopen redirectを避けるため、アプリ内の相対パスだけを
// 許可する(Issue #69: 招待受諾フローがログイン・登録・ニックネーム登録を
// 経由して元の受諾画面へ戻るために使う)。
export function toSafeRedirectPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // "//example.com"のようなscheme-relative URLは絶対URL扱いになるため除外する。
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // ブラウザはLocationヘッダーの"\"を"/"として解釈するため、
  // "/\evil.example.test"は"//evil.example.test"と等価になり得る。
  if (value.includes("\\")) return null;
  return value;
}
