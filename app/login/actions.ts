"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";
import type { AuthActionState } from "./state";

type Credentials = { email: string; password: string };

function readCredentials(formData: FormData): Credentials | null {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.includes("@") ||
    password.length < 6
  ) {
    return null;
  }

  return { email, password };
}

function invalidInput(): AuthActionState {
  return {
    message: "メールアドレスと6文字以上のパスワードを入力してください。",
    status: "error",
  };
}

export async function login(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const credentials = readCredentials(formData);
  if (credentials === null) return invalidInput();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error !== null) {
    return {
      message: "メールアドレスまたはパスワードを確認してください。",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const credentials = readCredentials(formData);
  if (credentials === null) return invalidInput();

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(credentials);
  if (error !== null) {
    return {
      message: "登録できませんでした。入力内容を確認してください。",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
