"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createConsumable as createConsumableInD1,
  updateConsumable as updateConsumableInD1,
  type ConsumableWriteInput,
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

function parseConsumableForm(
  formData: FormData,
): ({ status: "ok" } & ConsumableWriteInput) | ConsumableActionState {
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
    managedItemIds: selectedIds(formData, "managedItemIds"),
    name,
    note: note.value,
    productCode: productCode.value,
    status: "ok",
    taskRuleIds: selectedIds(formData, "taskRuleIds"),
  };
}

function writeInput(parsed: { status: "ok" } & ConsumableWriteInput): ConsumableWriteInput {
  return {
    externalUrl: parsed.externalUrl,
    managedItemIds: parsed.managedItemIds,
    name: parsed.name,
    note: parsed.note,
    productCode: parsed.productCode,
    taskRuleIds: parsed.taskRuleIds,
  };
}

export async function createConsumable(
  _previousState: ConsumableActionState,
  formData: FormData,
): Promise<ConsumableActionState> {
  const parsed = parseConsumableForm(formData);
  if (parsed.status !== "ok") return parsed;

  let id: string;
  try {
    const { db, session } = await getD1Context();
    id = await createConsumableInD1(db, session, writeInput(parsed));
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
  const parsed = parseConsumableForm(formData);
  if (parsed.status !== "ok") return parsed;

  try {
    const { db, session } = await getD1Context();
    await updateConsumableInD1(db, session, id, writeInput(parsed));
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
