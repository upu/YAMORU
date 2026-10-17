// 外部クライアントへ委任できる権限(scope)。docs/product/conversation-integration.md
// 3節「Principalと権限」を正本とする。家庭メンバーのOwner/Member区分ではなく、
// 利用者本人が接続ごとに選ぶ委任範囲である。

export const INTEGRATION_SCOPES = [
  "household.read",
  "household.write",
  "notifications.manage",
  "events.subscribe",
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

// 読み取り以外のscopeは、同じ家庭を読めることを前提に結果を返すため、
// どの接続にもreadを必ず含める(設計: 「readを併せて要求」)。
export const REQUIRED_SCOPE: IntegrationScope = "household.read";

export const SCOPE_DESCRIPTIONS: Record<IntegrationScope, { label: string; detail: string }> = {
  "household.read": {
    label: "家庭のデータを読む",
    detail: "同じ家庭の台帳・Todo・予定・履歴・在庫を読み取ります。",
  },
  "household.write": {
    label: "家庭のデータを変更する",
    detail: "登録・変更・完了・訂正を行います。家族全員が見るデータが変わります。",
  },
  "notifications.manage": {
    label: "あなたの通知設定を管理する",
    detail: "あなただけに効く通知時刻・静かな時間・スヌーズと配信履歴を扱います。",
  },
  "events.subscribe": {
    label: "あなた向けの通知を受け取る",
    detail:
      "あなた向けの通知候補を受け取り、定期取得では候補を確保して案内結果を報告します。通知設定の変更はできません。",
  },
};

export function isIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}

// 表示と保存の順序を一定にするため、定義順へ並べ替えて重複を除く。
export function normalizeScopes(scopes: Iterable<IntegrationScope>): IntegrationScope[] {
  const requested = new Set(scopes);
  return INTEGRATION_SCOPES.filter((scope) => requested.has(scope));
}

export function formatScopes(scopes: readonly IntegrationScope[]): string {
  return normalizeScopes(scopes).join(" ");
}

// 保存済みのscope文字列を読む。未知の値は捨てる(読み取り時に権限を広げない)。
export function parseStoredScopes(value: string): IntegrationScope[] {
  return normalizeScopes(value.split(" ").filter(isIntegrationScope));
}

export function hasScopes(
  granted: readonly IntegrationScope[],
  required: readonly IntegrationScope[],
): boolean {
  return required.every((scope) => granted.includes(scope));
}
