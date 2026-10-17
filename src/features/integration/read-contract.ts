export const ENTITY_KINDS = ["managed_item", "todo_rule", "todo_occurrence", "consumable"] as const;
export type EntityKind = typeof ENTITY_KINDS[number];

// Structural match for #436's verified IntegrationPrincipal; never construct from Tool input.
export type ReadPrincipal = {
  userId: string;
  householdId: string;
  clientId: string;
  connectionId: string;
  scopes: readonly string[];
};

const READ_ERROR_MESSAGES = {
  invalid_input: "入力内容を確認してください。",
  invalid_cursor: "検索条件またはデータが変わりました。最初から取得してください。",
  cursor_expired: "続きの取得期限が切れました。最初から取得してください。",
  not_found: "対象を取得できません。",
  forbidden: "この家庭のデータへアクセスできません。",
  unauthenticated: "ログインまたは再接続が必要です。",
  insufficient_scope: "読み取り権限が必要です。",
  read_conflict: "読み取り中にデータが変わりました。最初から取得してください。",
} as const;

export class ReadError extends Error {
  readonly retryable: boolean;
  readonly recovery: { action: "restart_read" | "check_request"; omit_cursor: boolean };
  constructor(public readonly code: keyof typeof READ_ERROR_MESSAGES) {
    super(READ_ERROR_MESSAGES[code]);
    this.retryable = code === "read_conflict";
    const restart = code === "read_conflict" || code === "invalid_cursor" || code === "cursor_expired";
    this.recovery = { action: restart ? "restart_read" : "check_request", omit_cursor: restart };
  }
}

export function objectInput(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ReadError("invalid_input");
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new ReadError("invalid_input");
  return value as Record<string, unknown>;
}

export function stringInput(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new ReadError("invalid_input");
  return value;
}

export function kindInput(value: unknown): EntityKind {
  if (!ENTITY_KINDS.some((kind) => kind === value)) throw new ReadError("invalid_input");
  return value as EntityKind;
}

export function limitInput(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) throw new ReadError("invalid_input");
  return value;
}

export function normalizeEntityText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/gu, "");
}

export type MatchReason = { field: "name" | "alias" | "related_name"; value: string };
export function matchEntity(query: string, name: string, aliases: string[], relatedName: string | null): MatchReason | null {
  for (const [field, values] of [["name", [name]], ["alias", aliases], ["related_name", relatedName === null ? [] : [relatedName]]] as const) {
    const value = values.find((text) => normalizeEntityText(text).includes(query));
    if (value !== undefined) return { field, value };
  }
  return null;
}

export function toWireValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWireValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), toWireValue(item),
  ]));
}
