"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";
import { isManagedItemKind, isSafeExternalUrl } from "./model";
import type { ManagedItemActionState } from "./state";

const MANAGED_ITEM_NAME_MAX_LENGTH = 100;
const EXTERNAL_URL_MAX_LENGTH = 2048;

function invalidName(): ManagedItemActionState {
  return {
    message: "名前は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

export async function createManagedItem(
  _previousState: ManagedItemActionState,
  formData: FormData,
): Promise<ManagedItemActionState> {
  const rawName = formData.get("name");
  const rawKind = formData.get("kind");
  const rawExternalUrl = formData.get("externalUrl");

  if (typeof rawName !== "string") return invalidName();

  const name = rawName.trim();
  if (
    name.length === 0 ||
    Array.from(name).length > MANAGED_ITEM_NAME_MAX_LENGTH
  ) {
    return invalidName();
  }

  if (typeof rawKind !== "string" || !isManagedItemKind(rawKind)) {
    return { message: "種類を選択してください。", status: "error" };
  }

  const externalUrl =
    typeof rawExternalUrl === "string" ? rawExternalUrl.trim() : "";
  if (
    externalUrl.length > EXTERNAL_URL_MAX_LENGTH ||
    (externalUrl.length > 0 && !isSafeExternalUrl(externalUrl))
  ) {
    return {
      message: "外部リンクはhttpまたはhttpsの絶対URLで入力してください。",
      status: "error",
    };
  }

  const supabase = await createClient();
  const response = await supabase.rpc("create_managed_item", {
    external_url: externalUrl.length === 0 ? null : externalUrl,
    item_kind: rawKind,
    item_name: name,
  });
  const data: unknown = response.data;
  const error: unknown = response.error;

  if (error !== null || typeof data !== "string") {
    return {
      message: "管理対象を登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/managed-items");
  redirect(`/managed-items/${encodeURIComponent(data)}`);
}
