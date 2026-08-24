"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@auth/core/errors";

import { signIn } from "../../auth";
import { MIN_PASSWORD_LENGTH } from "../../lib/auth/password-policy";
import { toSafeRedirectPath } from "../../lib/auth/safe-redirect";
import type { AuthActionState } from "./state";

type Credentials = { email: string; password: string };

function readCredentials(formData: FormData): Credentials | null {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.includes("@") ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    return null;
  }

  return { email, password };
}

function invalidInput(): AuthActionState {
  return {
    message: `メールアドレスと${String(MIN_PASSWORD_LENGTH)}文字以上のパスワードを入力してください。`,
    status: "error",
  };
}

export async function login(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const credentials = readCredentials(formData);
  if (credentials === null) return invalidInput();
  const next = toSafeRedirectPath(formData.get("next"));

  revalidatePath("/", "layout");
  try {
    await signIn("credentials", {
      ...credentials,
      redirectTo: next ?? "/",
    });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return {
      message: "メールアドレスまたはパスワードを確認してください。",
      status: "error",
    };
  }
  return { message: "", status: "idle" };
}
