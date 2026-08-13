export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "expired",
  "cancelled",
  "replaced",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  accepted: "使用済み",
  cancelled: "取消済み",
  expired: "期限切れ",
  pending: "有効",
  replaced: "再発行済み",
};

export function isInvitationStatus(value: string): value is InvitationStatus {
  return INVITATION_STATUSES.some((status) => status === value);
}

// list_household_invitationsのstatusは生成された型ではstring(Postgres関数のtext
// 戻り値のため)。DBの状態計算(migration側のCASE式)とここでの想定がズレたら、
// 未知のラベルを黙って表示せずその場で失敗させる。
export function toInvitationStatus(value: string): InvitationStatus {
  if (!isInvitationStatus(value)) {
    throw new Error(`未知の招待の状態です: ${value}`);
  }

  return value;
}

// 家庭メンバーが操作できるのは、まだ受諾も取消も再発行もされていない招待だけ。
export function isInvitationActionable(status: InvitationStatus): boolean {
  return status === "pending" || status === "expired";
}
