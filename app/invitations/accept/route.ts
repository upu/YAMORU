import { NextResponse, type NextRequest } from "next/server";

import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
  INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
} from "../../../lib/invitations/claim-cookie";
import { createClient } from "../../../lib/supabase/server";

const CONFIRM_PATH = "/invitations/accept/confirm";

// Issue #69 (YDR-019): 招待リンクの最初の到達点。
//
// ?tokenを持つ場合(招待リンクそのもの)は、生トークンを一時状態(claim)へ
// 交換してhttpOnly cookieへ格納し、tokenを含まないURLへリダイレクトする
// (YDR-019「生の招待トークンをURLに含めたまま認証フローを回さない」)。
// ?tokenを持たない場合(ログイン・ニックネーム登録からの復帰)は、既存の
// claim cookieをそのまま確認ページへ引き継ぐ。
//
// 交換RPC(open_invitation_claim)はトークンの有効性によらず常に成功する
// 設計のため、ここで失敗するのは想定外の障害時だけである。その場合はcookieを
// 設定せず、確認ページの共通エラー表示に委ねる(有効・無効で応答を変えない)。
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const response = NextResponse.redirect(new URL(CONFIRM_PATH, request.url), {
    status: 303,
  });

  if (token === null || token.length === 0) {
    return response;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_invitation_claim", {
    invitation_token: token,
  });

  const claim = data?.[0];
  if (error !== null || claim === undefined) {
    return response;
  }

  const remainingSeconds = Math.floor(
    (new Date(claim.expires_at).getTime() - Date.now()) / 1000,
  );
  const maxAgeSeconds = Math.min(
    INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
    Math.max(1, remainingSeconds),
  );

  response.cookies.set(INVITE_CLAIM_COOKIE_NAME, claim.claim_secret, {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: INVITE_CLAIM_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
