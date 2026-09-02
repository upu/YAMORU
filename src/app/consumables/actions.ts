"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createConsumable as createConsumableInD1,
  updateConsumable as updateConsumableInD1,
  type ConsumableAttributesInput,
} from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";
import { isSafeExternalUrl } from "../managed-items/model";
import type { ConsumableActionState } from "./state";

const NAME_MAX_LENGTH = 100;
const NOTE_MAX_LENGTH = 1000;
const PRODUCT_CODE_MAX_LENGTH = 200;
const EXTERNAL_URL_MAX_LENGTH = 2048;

function optionalText(
  formData: FormData,
  field: string,
  label: string,
  maxLength: number,
): { status: "ok"; value: string | null } | ConsumableActionState {
  const raw = formData.get(field);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (Array.from(value).length > maxLength) {
    return {
      message: `${label}は${String(maxLength)}文字以内で入力してください。`,
      status: "error",
    };
  }
  return { status: "ok", value: value === "" ? null : value };
}

function selectedIds(formData: FormData, field: string): string[] {
  return [...new Set(
    formData.getAll(field)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

// Issue #311: 関連付けは詳細画面から1件ずつ操作する。フォームが扱うのは
// 名前・型番・外部リンク・メモという消耗品本体の属性だけとし、登録のときに
// 限って最初の関連もあわせて受け取る。
function parseConsumableAttributes(
  formData: FormData,
): ({ status: "ok" } & ConsumableAttributesInput) | ConsumableActionState {
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "" || Array.from(name).length > NAME_MAX_LENGTH) {
    return {
      message: "名前は1文字以上100文字以内で入力してください。",
      status: "error",
    };
  }

  const note = optionalText(formData, "note", "メモ", NOTE_MAX_LENGTH);
  if (note.status !== "ok") return note;
  const productCode = optionalText(
    formData,
    "productCode",
    "型番・品番",
    PRODUCT_CODE_MAX_LENGTH,
  );
  if (productCode.status !== "ok") return productCode;
  const externalUrl = optionalText(
    formData,
    "externalUrl",
    "外部リンク",
    EXTERNAL_URL_MAX_LENGTH,
  );
  if (externalUrl.status !== "ok") return externalUrl;
  if (externalUrl.value !== null && !isSafeExternalUrl(externalUrl.value)) {
    return {
      message: "外部リンクはhttpまたはhttpsの絶対URLで入力してください。",
      status: "error",
    };
  }

  return {
    externalUrl: externalUrl.value,
    name,
    note: note.value,
    productCode: productCode.value,
    status: "ok",
  };
}

function attributesInput(
  parsed: { status: "ok" } & ConsumableAttributesInput,
): ConsumableAttributesInput {
  return {
    externalUrl: parsed.externalUrl,
    name: parsed.name,
    note: parsed.note,
    productCode: parsed.productCode,
  };
}

export async function createConsumable(
  _previousState: ConsumableActionState,
  formData: FormData,
): Promise<ConsumableActionState> {
  const parsed = parseConsumableAttributes(formData);
  if (parsed.status !== "ok") return parsed;

  let id: string;
  try {
    const { db, session } = await getD1Context();
    id = await createConsumableInD1(db, session, {
      ...attributesInput(parsed),
      managedItemIds: selectedIds(formData, "managedItemIds"),
      taskRuleIds: selectedIds(formData, "taskRuleIds"),
    });
  } catch {
    return {
      message: "消耗品を登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/consumables");
  revalidatePath("/managed-items");
  revalidatePath("/todos");
  redirect(`/consumables/${encodeURIComponent(id)}`);
}

export async function updateConsumable(
  _previousState: ConsumableActionState,
  formData: FormData,
): Promise<ConsumableActionState> {
  const rawId = formData.get("id");
  if (typeof rawId !== "string" || rawId.trim() === "") {
    return { message: "消耗品を特定できませんでした。", status: "error" };
  }
  const id = rawId.trim();
  const parsed = parseConsumableAttributes(formData);
  if (parsed.status !== "ok") return parsed;

  try {
    const { db, session } = await getD1Context();
    await updateConsumableInD1(db, session, id, attributesInput(parsed));
  } catch {
    return {
      message: "消耗品を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/consumables");
  revalidatePath(`/consumables/${encodeURIComponent(id)}`);
  revalidatePath("/managed-items");
  revalidatePath("/todos");
  redirect(`/consumables/${encodeURIComponent(id)}`);
}
