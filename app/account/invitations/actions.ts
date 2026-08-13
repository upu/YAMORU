"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createClient } from "../../../lib/supabase/server";
import type { CancelInvitationState, IssueInvitationState } from "./state";

const INVITED_EMAIL_MIN_LENGTH = 3;
const INVITED_EMAIL_MAX_LENGTH = 320;
const ACCEPT_INVITATION_PATH = "/invitations/accept";

function invalidInvitedEmail(): IssueInvitationState {
  return {
    message: "招待先メールアドレスを正しく入力してください。",
    status: "error",
  };
}

function isPlausibleEmail(value: string): boolean {
  const atIndex = value.indexOf("@");
  return (
    value.length >= INVITED_EMAIL_MIN_LENGTH &&
    value.length <= INVITED_EMAIL_MAX_LENGTH &&
    atIndex > 0 &&
    atIndex < value.length - 1
  );
}

// リクエストのHostヘッダーから、招待リンクの絶対URLを組み立てる。
// 環境ごとの公開URLを別途設定せずに済むよう、常に受信したリクエスト自身の
// オリジンを使う(dev/test/prodいずれの環境でも動く)。
async function buildAcceptInvitationLink(token: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  const origin = host !== null ? `${protocol}://${host}` : "";

  const url = new URL(ACCEPT_INVITATION_PATH, origin || "http://localhost");
  url.searchParams.set("token", token);
  return origin ? url.toString() : url.pathname + url.search;
}

export async function issueInvitation(
  _previousState: IssueInvitationState,
  formData: FormData,
): Promise<IssueInvitationState> {
  const rawEmail = formData.get("invitedEmail");
  if (typeof rawEmail !== "string") return invalidInvitedEmail();

  const invitedEmail = rawEmail.trim();
  if (!isPlausibleEmail(invitedEmail)) return invalidInvitedEmail();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_household_invitation", {
    invited_email: invitedEmail,
  });

  const issued = data?.[0];
  if (error !== null || issued === undefined) {
    return {
      message: "招待を発行できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/account/invitations");

  return {
    expiresAt: issued.expires_at,
    invitedEmail: issued.invitation_email,
    link: await buildAcceptInvitationLink(issued.token),
    status: "issued",
  };
}

export async function cancelInvitation(
  _previousState: CancelInvitationState,
  formData: FormData,
): Promise<CancelInvitationState> {
  const invitationId = formData.get("invitationId");
  if (typeof invitationId !== "string" || invitationId.length === 0) {
    return {
      message: "招待を取消できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_household_invitation", {
    invitation_id: invitationId,
  });

  if (error !== null) {
    return {
      message: "招待を取消できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/account/invitations");
  return { message: "", status: "idle" };
}
