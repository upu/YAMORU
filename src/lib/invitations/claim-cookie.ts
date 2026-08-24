// 招待claim secretを認証フロー(ログイン・招待登録・
// ニックネーム登録)の間だけ引き継ぐための一時cookie。
//
// pathを/invitations/acceptに絞ることで、claim secretは招待受諾に関係する
// リクエストにしか送出されない(YDR-019「Refererでの送出やログへの記録を
// 避ける」の実務上の徹底)。httpOnlyのため、クライアント側JSやページの
// HTMLソースにも値が現れない。

export const INVITE_CLAIM_COOKIE_NAME = "yamoru_invite_claim";
export const INVITE_CLAIM_COOKIE_PATH = "/invitations/accept";
export const INVITE_CLAIM_RESUME_PATH = "/invitations/accept/resume";

// D1 claimの残り期限が異常な場合にもcookieを30分より長くしないための上限。
export const INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS = 30 * 60;
