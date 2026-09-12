// D1層のエラー分類(クラス)と、アプリが明示的に投げる業務エラーの識別コード
// (Issue #369)。
//
// 三つの区別:
// - 業務エラー: アプリ自身がif文で投げる、利用者の操作で起こりうる失敗。
//   D1_ERROR_CODESの識別コードを持ち、呼び出し側はこのコードだけで案内文を
//   選ぶ。内部の英文メッセージは開発者向けのログ用途であり、変更しても
//   利用者向けの案内は変わらない。
// - 外部エラー: SQLite/D1が返す制約違反など。文字列判定はD1層(境界)に閉じ、
//   意味が確定するものだけを業務エラーへ読み替える。
// - 予期しないエラー: 不変条件違反(例: 繰り返しTodoに予定がない)や想定外の
//   失敗。コードを持たせず、呼び出し側の一般的な失敗表示へ落とす。

// 識別コードの一覧。値は画面の案内文と対応づけるための安定した識別子であり、
// 表示はしない。追加するときは発生箇所とactionの対応表も更新する。
export const D1_ERROR_CODES = [
  // 参照先が同じ家庭に見つからない
  "ASSIGNEE_NOT_FOUND",
  "MANAGED_ITEM_NOT_FOUND",
  "OCCURRENCE_NOT_FOUND",
  "PERFORMER_NOT_FOUND",
  // 対象Occurrenceの状態が操作の前提と違う
  "OCCURRENCE_ALREADY_ASSIGNED",
  "OCCURRENCE_NOT_COMPLETED",
  "OCCURRENCE_NOT_PENDING",
  // 日付・予定の制約
  "DUE_AT_BEFORE_SCHEDULED_FOR",
  "DUE_AT_NOT_IN_FUTURE",
  "NEXT_OCCURRENCE_MODIFIED",
  "NEXT_OCCURRENCE_SCHEDULE_TAKEN",
  "OCCURRED_AT_IN_FUTURE",
  "OCCURRENCE_SCHEDULE_TAKEN",
  "UNDATED_OCCURRENCE_NOT_POSTPONABLE",
  // 繰り返し方式による操作の制限
  "EDIT_REQUIRES_ONE_TIME",
  "MANUAL_TODO_HAS_NO_SCHEDULE",
  "RECURRENCE_BASIS_IMMUTABLE",
  "RECURRING_EDIT_REQUIRES_RECURRING",
  "UNDATED_SCHEDULE_REQUIRES_ONE_TIME",
  // 再送の取り違え
  "IDEMPOTENCY_KEY_REUSED",
] as const;

export type D1ErrorCode = (typeof D1_ERROR_CODES)[number];

// 既存の呼び出しを壊さないため、codeは省略できる。省略したエラーは
// 「予期しないエラー」として扱われ、呼び出し側の一般的な失敗表示になる。
export class D1Error extends Error {
  readonly code: D1ErrorCode | undefined;

  constructor(message: string, code?: D1ErrorCode) {
    super(message);
    this.code = code;
  }
}

export class D1UnauthorizedError extends D1Error {}
export class D1ForbiddenError extends D1Error {}
export class D1NotFoundError extends D1Error {}
export class D1ConflictError extends D1Error {}

function isD1ErrorCode(value: string): value is D1ErrorCode {
  return (D1_ERROR_CODES as readonly string[]).includes(value);
}

// instanceofではなくcodeの値で判定する。Server ActionsとD1層が別々に
// バンドルされてもクラス同一性に依存せず、Node組み込みエラーの`code`
// (ENOENT等)は一覧にないため取り違えない。
export function d1ErrorCode(error: unknown): D1ErrorCode | undefined {
  if (!(error instanceof Error)) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" && isD1ErrorCode(code) ? code : undefined;
}
