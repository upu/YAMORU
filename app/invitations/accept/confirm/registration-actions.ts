"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { signIn } from "../../../../auth";
import { hashPassword } from "../../../../lib/auth/password";
import { MIN_PASSWORD_LENGTH } from "../../../../lib/auth/password-policy";
import { getD1Database } from "../../../../lib/d1/client";
import { D1ConflictError } from "../../../../lib/d1/errors";
import { registerInvitedUser } from "../../../../lib/d1/invitations";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
} from "../../../../lib/invitations/claim-cookie";

export type InvitationRegistrationState = {
  message: string;
  status: "error" | "idle";
};

function invalidInput(message: string): InvitationRegistrationState {
  return { message, status: "error" };
}

export async function registerFromInvitation(
  _previousState: InvitationRegistrationState,
  formData: FormData,
): Promise<InvitationRegistrationState> {
  const email = formData.get("email");
  const nickname = formData.get("nickname");
  const password = formData.get("password");
  const passwordConfirmation = formData.get("passwordConfirmation");
  if (
    typeof email !== "string" || !email.includes("@") ||
    typeof nickname !== "string" || nickname.trim().length === 0 ||
    Array.from(nickname.trim()).length > 20 ||
    typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH ||
    password !== passwordConfirmation
  ) {
    return invalidInput(
      `ニックネームと${String(MIN_PASSWORD_LENGTH)}文字以上の同じパスワードを入力してください。`,
    );
  }

  const cookieStore = await cookies();
  const claimSecret = cookieStore.get(INVITE_CLAIM_COOKIE_NAME)?.value;
  if (claimSecret === undefined) return invalidInput("この招待は利用できません。");

  try {
    const db = await getD1Database();
    const passwordHash = await hashPassword(password);
    await registerInvitedUser(db, {
      claimSecret,
      email,
      nickname: nickname.trim(),
      passwordHash,
    });
  } catch (error) {
    if (error instanceof D1ConflictError) {
      cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });
      return invalidInput("この招待は利用できません。");
    }
    throw error;
  }

  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });
  revalidatePath("/", "layout");
  await signIn("credentials", { email, password, redirectTo: "/" });
  return { message: "", status: "idle" };
}
