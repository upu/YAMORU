import { NextResponse, type NextRequest } from "next/server";

import { getD1Database } from "../../../lib/d1/client";
import { openInvitationClaim } from "../../../lib/d1/invitations";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
  INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
} from "../../../lib/invitations/claim-cookie";

const CONFIRM_PATH = "/invitations/accept/confirm";

// 生tokenは最初の到達でD1上の短命claimへ交換し、URLから必ず除去する。
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const response = NextResponse.redirect(new URL(CONFIRM_PATH, request.url), {
    status: 303,
  });

  if (token === null || token.length === 0) {
    return response;
  }

  let claim;
  try {
    const db = await getD1Database();
    claim = await openInvitationClaim(db, token);
  } catch {
    return response;
  }
  if (claim === null) return response;

  const remainingSeconds = Math.floor(
    (new Date(claim.expiresAt).getTime() - Date.now()) / 1000,
  );
  const maxAgeSeconds = Math.min(
    INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
    Math.max(1, remainingSeconds),
  );

  response.cookies.set(INVITE_CLAIM_COOKIE_NAME, claim.claimSecret, {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: INVITE_CLAIM_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
