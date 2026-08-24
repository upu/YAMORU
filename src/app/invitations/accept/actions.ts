"use server";

import { cookies } from "next/headers";

import { getD1Database } from "../../../lib/d1/client";
import { openInvitationClaim } from "../../../lib/d1/invitations";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
  INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
} from "../../../lib/invitations/claim-cookie";

// 生tokenはURL fragmentとしてブラウザーへ渡るため、サーバーへの最初の
// requestには一切含まれない(#140)。クライアントはページ読み込み直後に
// fragmentから読み取った生tokenを、このServer Actionのrequest bodyとして
// 一度だけ渡す。ここでD1上の短命claimへ交換し、以後はHttpOnly cookieだけで
// 引き継ぐ(YDR-023)。
export async function openInvitationClaimAction(token: string): Promise<void> {
  if (token.length === 0) return;

  let claim;
  try {
    const db = await getD1Database();
    claim = await openInvitationClaim(db, token);
  } catch {
    return;
  }
  if (claim === null) return;

  const remainingSeconds = Math.floor(
    (new Date(claim.expiresAt).getTime() - Date.now()) / 1000,
  );
  const maxAgeSeconds = Math.min(
    INVITE_CLAIM_FALLBACK_MAX_AGE_SECONDS,
    Math.max(1, remainingSeconds),
  );

  const cookieStore = await cookies();
  cookieStore.set(INVITE_CLAIM_COOKIE_NAME, claim.claimSecret, {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: INVITE_CLAIM_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
