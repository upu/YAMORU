"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signOut } from "../../auth";
import { requireUser } from "../../lib/auth/current-user";
import { MIN_PASSWORD_LENGTH } from "../../lib/auth/password-policy";
import { changePassword } from "../../lib/d1/authentication";
import { getD1Database } from "../../lib/d1/client";
import { D1ConflictError, D1UnauthorizedError } from "../../lib/d1/errors";

export type PasswordChangeState = {
  message: string;
  status: "error" | "idle";
};

export async function updatePassword(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmation = formData.get("newPasswordConfirmation");
  if (
    typeof currentPassword !== "string" || currentPassword.length === 0 ||
    typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH ||
    newPassword !== confirmation
  ) {
    return {
      message: `現在のパスワードと、${String(MIN_PASSWORD_LENGTH)}文字以上の同じ新しいパスワードを入力してください。`,
      status: "error",
    };
  }

  const user = await requireUser();
  const db = await getD1Database();
  try {
    await changePassword(
      db,
      { sessionVersion: user.sessionVersion, userId: user.id },
      currentPassword,
      newPassword,
    );
  } catch (error) {
    if (error instanceof D1UnauthorizedError || error instanceof D1ConflictError) {
      return { message: "現在のパスワードを確認してください。", status: "error" };
    }
    throw error;
  }

  await signOut({ redirect: false });
  revalidatePath("/", "layout");
  redirect("/login?passwordChanged=1");
}
