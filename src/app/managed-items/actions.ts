"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../lib/d1/context";
import {
  createManagedItem as createManagedItemInD1,
  updateManagedItem as updateManagedItemInD1,
} from "../../lib/d1/managed-items";
import { isSafeExternalUrl, startedOnLabel } from "./model";
import { toStartedOn } from "./started-on";
import type { ManagedItemActionState } from "./state";

const MANAGED_ITEM_NAME_MAX_LENGTH = 100;
const CUSTOM_ITEM_TYPE_MAX_LENGTH = 50;
const EXTERNAL_URL_MAX_LENGTH = 2048;
const NOTE_MAX_LENGTH = 1000;
const PRODUCT_INFO_MAX_LENGTH = 200;

function invalidName(): ManagedItemActionState {
  return {
    message: "名前は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

type ParsedManagedItemForm =
  | {
      customItemType: string | null;
      externalUrl: string | null;
      itemTypeCode: string | null;
      kindCode: string;
      name: string;
      note: string | null;
      productInfo: string | null;
      startedOn: string | null;
      status: "ok";
    }
  | ManagedItemActionState;

type ParsedOptionalAttributes = {
  note: string | null;
  productInfo: string | null;
  startedOn: string | null;
  status: "ok";
} | ManagedItemActionState;

type ParsedClassification = {
  customItemType: string | null;
  itemTypeCode: string | null;
  kindCode: string;
  status: "ok";
} | ManagedItemActionState;

function parseName(formData: FormData): string | ManagedItemActionState {
  const rawName = formData.get("name");
  if (typeof rawName !== "string") return invalidName();

  const name = rawName.trim();
  if (
    name.length === 0 ||
    Array.from(name).length > MANAGED_ITEM_NAME_MAX_LENGTH
  ) {
    return invalidName();
  }
  return name;
}

function parseClassification(formData: FormData): ParsedClassification {
  const rawKindCode = formData.get("kindCode");
  if (typeof rawKindCode !== "string" || rawKindCode.trim().length === 0) {
    return { message: "大分類を選択してください。", status: "error" };
  }

  const rawItemTypeCode = formData.get("itemTypeCode");
  const itemTypeValue = typeof rawItemTypeCode === "string"
    ? rawItemTypeCode.trim()
    : "";
  if (itemTypeValue !== "__custom__") {
    return {
      customItemType: null,
      itemTypeCode: itemTypeValue.length === 0 ? null : itemTypeValue,
      kindCode: rawKindCode.trim(),
      status: "ok",
    };
  }

  const rawCustomItemType = formData.get("customItemType");
  const customItemType = typeof rawCustomItemType === "string"
    ? rawCustomItemType.trim()
    : "";
  if (
    customItemType.length === 0
    || Array.from(customItemType).length > CUSTOM_ITEM_TYPE_MAX_LENGTH
  ) {
    return {
      message: "詳しい種類は1文字以上50文字以内で入力してください。",
      status: "error",
    };
  }
  return {
    customItemType,
    itemTypeCode: null,
    kindCode: rawKindCode.trim(),
    status: "ok",
  };
}

function parseExternalUrl(formData: FormData):
  | { status: "ok"; value: string | null }
  | ManagedItemActionState {
  const rawExternalUrl = formData.get("externalUrl");
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
  return { status: "ok", value: externalUrl.length === 0 ? null : externalUrl };
}

// Issue #42: 任意の自由入力。空欄は未設定として扱う。前後の空白だけを落とし、
// 大文字小文字・記号・語中の空白・改行は入力どおり保存する(型番の表記を
// 勝手に変えない)。
function parseOptionalText(
  formData: FormData,
  field: string,
  label: string,
  maxLength: number,
): { status: "ok"; value: string | null } | ManagedItemActionState {
  const raw = formData.get(field);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (Array.from(value).length > maxLength) {
    return {
      message: `${label}は${String(maxLength)}文字以内で入力してください。`,
      status: "error",
    };
  }
  return { status: "ok", value: value.length === 0 ? null : value };
}

function formValue(formData: FormData, field: string): string {
  const raw = formData.get(field);
  return typeof raw === "string" ? raw : "";
}

// Issue #239: 入力エラーの文言も、選択中の大分類に合う見出し語(「購入時期」
// など)で伝える(YDR-033)。kindCodeは分類の妥当性を検証済みとは限らない
// (大分類の存在確認はrequireActiveClassificationがD1側で行う)ため、未知の
// 値でもstartedOnLabelが「開始時期」へ丸める。
function parseOptionalAttributes(
  formData: FormData,
  kindCode: string,
): ParsedOptionalAttributes {
  const note = parseOptionalText(formData, "note", "メモ", NOTE_MAX_LENGTH);
  if (note.status !== "ok") return note;
  const productInfo = parseOptionalText(
    formData,
    "productInfo",
    "メーカー・商品名など",
    PRODUCT_INFO_MAX_LENGTH,
  );
  if (productInfo.status !== "ok") return productInfo;

  const startedOn = toStartedOn({
    day: formValue(formData, "startedDay"),
    month: formValue(formData, "startedMonth"),
    year: formValue(formData, "startedYear"),
  });
  if (startedOn.status !== "ok") {
    return {
      message: `${startedOnLabel(kindCode)}は、年、年と月、年月日のいずれかで入力してください。`,
      status: "error",
    };
  }

  return {
    note: note.value,
    productInfo: productInfo.value,
    startedOn: startedOn.value,
    status: "ok",
  };
}

// createManagedItem・updateManagedItemの両方が使う、名前・分類・外部リンク・
// 任意の記録の入力検証。登録と編集で許可する値・エラー文言を揃える。
function parseManagedItemForm(formData: FormData): ParsedManagedItemForm {
  const name = parseName(formData);
  if (typeof name !== "string") return name;
  const classification = parseClassification(formData);
  if (classification.status !== "ok") return classification;
  const externalUrl = parseExternalUrl(formData);
  if (externalUrl.status !== "ok") return externalUrl;
  const optional = parseOptionalAttributes(formData, classification.kindCode);
  if (optional.status !== "ok") return optional;

  return {
    customItemType: classification.customItemType,
    externalUrl: externalUrl.value,
    itemTypeCode: classification.itemTypeCode,
    kindCode: classification.kindCode,
    name,
    note: optional.note,
    productInfo: optional.productInfo,
    startedOn: optional.startedOn,
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
      customItemType: parsed.customItemType,
      externalUrl: parsed.externalUrl,
      itemTypeCode: parsed.itemTypeCode,
      kindCode: parsed.kindCode,
      name: parsed.name,
      note: parsed.note,
      productInfo: parsed.productInfo,
      startedOn: parsed.startedOn,
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
      customItemType: parsed.customItemType,
      externalUrl: parsed.externalUrl,
      itemTypeCode: parsed.itemTypeCode,
      kindCode: parsed.kindCode,
      name: parsed.name,
      note: parsed.note,
      productInfo: parsed.productInfo,
      startedOn: parsed.startedOn,
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
