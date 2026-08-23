"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../lib/d1/context";
import {
  createManagedItem as createManagedItemInD1,
  updateManagedItem as updateManagedItemInD1,
} from "../../lib/d1/managed-items";
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

type ParsedManagedItemForm =
  | { externalUrl: string | null; kind: string; name: string; status: "ok" }
  | ManagedItemActionState;

// createManagedItem・updateManagedItemの両方が使う、名前・種類・外部リンクの
// 入力検証。登録と編集で許可する値・エラー文言を揃える。
function parseManagedItemForm(formData: FormData): ParsedManagedItemForm {
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

  return {
    externalUrl: externalUrl.length === 0 ? null : externalUrl,
    kind: rawKind,
    name,
    status: "ok",
  };
}

export async function createManagedItem(
  _previousState: ManagedItemActionState,
  formData: FormData,
): Promise<ManagedItemActionState> {
  const parsed = parseManagedItemForm(formData);
  if (parsed.status !== "ok") return parsed;

  let itemId: string;
  try {
    const { db, session } = await getD1Context();
    itemId = await createManagedItemInD1(db, session, {
      externalUrl: parsed.externalUrl,
      kind: parsed.kind,
      name: parsed.name,
    });
  } catch {
    return {
      message: "管理対象を登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/managed-items");
  redirect(`/managed-items/${encodeURIComponent(itemId)}`);
}

// Issue #40: 自家庭のManagedItemの名前・種類・外部リンクを編集する。対象IDは
// フォームの隠しフィールド(id)から受け取る(createTodoのmanagedItemId等と
// 同じ、useActionStateのaction型(prevState, formData)を崩さない方式)。
// 対象が自家庭に見つからない場合はupdateManagedItemInD1がNot Foundとして
// 拒否する(家庭Bへの操作を防ぐ)。
export async function updateManagedItem(
  _previousState: ManagedItemActionState,
  formData: FormData,
): Promise<ManagedItemActionState> {
  const rawId = formData.get("id");
  if (typeof rawId !== "string" || rawId.length === 0) {
    return { message: "管理対象を特定できませんでした。", status: "error" };
  }

  const parsed = parseManagedItemForm(formData);
  if (parsed.status !== "ok") return parsed;

  try {
    const { db, session } = await getD1Context();
    await updateManagedItemInD1(db, session, rawId, {
      externalUrl: parsed.externalUrl,
      kind: parsed.kind,
      name: parsed.name,
    });
  } catch {
    return {
      message: "管理対象を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/managed-items");
  revalidatePath(`/managed-items/${encodeURIComponent(rawId)}`);
  redirect(`/managed-items/${encodeURIComponent(rawId)}`);
}
