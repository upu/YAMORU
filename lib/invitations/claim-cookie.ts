// Issue #69 (YDR-019): 招待claim secretを認証フロー(ログイン・新規登録・
// ニックネーム登録)の間だけ引き継ぐための一時cookie。
//
// pathを/invitations/acceptに絞ることで、claim secretは招待受諾に関係する
// リクエストにしか送出されない(YDR-019「Refererでの送出やログへの記録を
// 避ける」の実務上の徹底)。httpOnlyのため、クライアント側JSやページの
// HTMLソースにも値が現れない。

export const INVITE_CLAIM_COOKIE_NAME = "yamoru_invite_claim";
export const INVITE_CLAIM_COOKIE_PATH = "/invitations/accept";

// 交換RPC(open_invitation_claim)のexpires_atが返らない異常系のための保険。
// 正常系はRPCが返す実際の残り期限(招待自体の残り期限でキャップ済み)を使う。
export const INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS = 30 * 60;
