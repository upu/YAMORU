// 外部clientの変更操作(command_prepare / command_commit / operation_get)の
// 入出力とエラーの契約。docs/product/conversation-integration.md 5節を正本とし、
// 値はMCP等の外部へそのまま返すためsnake_caseで組み立てる。

export const COMMAND_NAMES = [
  "managed_item.create",
  "managed_item.update",
  "managed_item_with_todo.create",
  "notification.configure",
  "notification.snooze",
  "todo.complete",
  "todo.correct",
  "todo.create",
  "todo.reschedule",
  "todo.undo",
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && (COMMAND_NAMES as readonly string[]).includes(value);
}

// previewの有効期間(5節「previewは10分有効」)。
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export type CommandTarget = {
  id: string;
  kind: "attention_candidate" | "completion_log" | "managed_item" | "notification_settings" | "todo_occurrence";
};

// 対象を新しく作るcommand(todo.create等)は対象を持たない(5節)。
export type NormalizedCommand = {
  command: CommandName;
  payload: Record<string, unknown>;
  target: CommandTarget | null;
};

export type CommandPreview = {
  affected_entities: Record<string, unknown>[];
  diff: Record<string, unknown>;
  schedule_effect: Record<string, unknown>;
};

const COMMAND_ERRORS = {
  already_resolved: { message: "対象はすでに別の操作で処理されています。現在の状態を確認してください。", recovery: "reread", retryable: false },
  connection_revoked: { message: "この接続は解除されています。再接続してください。", recovery: "reconnect", retryable: false },
  idempotency_conflict: { message: "同じ操作IDで別の内容が送られました。新しい操作として作り直してください。", recovery: "new_operation", retryable: false },
  insufficient_scope: { message: "この操作に必要な権限がありません。許可する範囲を確認してください。", recovery: "reconnect", retryable: false },
  invalid_input: { message: "入力内容を確認してください。", recovery: "check_request", retryable: false },
  missing_required: { message: "必要な項目が足りません。足りない項目だけを確認してください。", recovery: "ask_user", retryable: false },
  not_found: { message: "対象を取得できません。", recovery: "reread", retryable: false },
  preview_expired: { message: "確認内容の有効期限が切れました。現在の状態を読み直して、新しい操作として作り直してください。", recovery: "reread", retryable: false },
  stale_preview: { message: "確認した後に対象が変わりました。現在の状態を読み直して、新しい操作として作り直してください。", recovery: "reread", retryable: false },
  temporarily_unavailable: { message: "一時的に処理できませんでした。同じ操作IDで結果を確認してから再試行してください。", recovery: "operation_get", retryable: true },
  unsafe_undo: { message: "後から家族が変更した内容を消してしまうため、この操作は実行できません。", recovery: "reread", retryable: false },
  unsupported_capability: { message: "この機能にはまだ対応していません。", recovery: "check_request", retryable: false },
} as const;

export type CommandErrorCode = keyof typeof COMMAND_ERRORS;

export function isCommandErrorCode(value: string): value is CommandErrorCode {
  return Object.hasOwn(COMMAND_ERRORS, value);
}

// 操作を拒否として確定させ、同じ操作IDの再送にも同じ結果を返すエラー。
// 一時的な失敗や認可の失敗は確定させず、接続の回復後に同じIDで照合できる。
const FINAL_CODES: ReadonlySet<CommandErrorCode> = new Set([
  "already_resolved",
  "invalid_input",
  "missing_required",
  "not_found",
  "stale_preview",
  "unsafe_undo",
]);

export class CommandError extends Error {
  readonly currentState: Record<string, unknown> | undefined;
  readonly fieldErrors: Record<string, string> | undefined;
  readonly operationId: string | undefined;
  readonly recovery: string;
  readonly retryable: boolean;

  constructor(
    readonly code: CommandErrorCode,
    details: {
      currentState?: Record<string, unknown>;
      fieldErrors?: Record<string, string>;
      operationId?: string;
    } = {},
  ) {
    super(COMMAND_ERRORS[code].message);
    this.currentState = details.currentState;
    this.fieldErrors = details.fieldErrors;
    this.operationId = details.operationId;
    this.recovery = COMMAND_ERRORS[code].recovery;
    this.retryable = COMMAND_ERRORS[code].retryable;
  }

  get final(): boolean {
    return FINAL_CODES.has(this.code);
  }

  withOperation(operationId: string): CommandError {
    return new CommandError(this.code, {
      currentState: this.currentState,
      fieldErrors: this.fieldErrors,
      operationId,
    });
  }

  toWire(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      recovery: this.recovery,
      ...(this.operationId === undefined ? {} : { operation_id: this.operationId }),
      ...(this.fieldErrors === undefined ? {} : { field_errors: this.fieldErrors }),
      ...(this.currentState === undefined ? {} : { current_state: this.currentState }),
    };
  }
}

export function invalidInput(field: string, reason: string): CommandError {
  return new CommandError("invalid_input", { fieldErrors: { [field]: reason } });
}

// キーを並べ替えたJSON。同じ内容の要求・正規化結果が同じ文字列になる。
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
