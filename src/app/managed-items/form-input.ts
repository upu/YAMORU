import { isSafeExternalUrl } from "./model";

// 管理対象の登録・編集で受け付ける値の規則。Webのフォーム(actions.ts)と
// 外部command(#437のmanaged_item.create)が同じ規則で正規化するため、
// FormDataや画面の文言に依存しない値の判定だけをここへ置く。

export const MANAGED_ITEM_NAME_MAX_LENGTH = 100;
export const CUSTOM_ITEM_TYPE_MAX_LENGTH = 50;
export const EXTERNAL_URL_MAX_LENGTH = 2048;
export const NOTE_MAX_LENGTH = 1000;
export const PRODUCT_INFO_MAX_LENGTH = 200;

export type OptionalValueResult = { status: "error" } | { status: "ok"; value: string | null };

// 名前・自由入力の詳しい種類など、空にできない文字列。前後の空白を落とし、
// 1文字以上maxLength文字以内でなければnullを返す。
export function normalizeRequiredText(raw: string, maxLength: number): string | null {
  const value = raw.trim();
  if (value.length === 0 || Array.from(value).length > maxLength) return null;
  return value;
}

// Issue #42: 任意の自由入力。空欄は未設定として扱う。前後の空白だけを落とし、
// 大文字小文字・記号・語中の空白・改行は入力どおり保存する(型番の表記を
// 勝手に変えない)。
export function normalizeOptionalText(raw: string, maxLength: number): OptionalValueResult {
  const value = raw.trim();
  if (Array.from(value).length > maxLength) return { status: "error" };
  return { status: "ok", value: value.length === 0 ? null : value };
}

export function normalizeExternalUrl(raw: string): OptionalValueResult {
  const value = raw.trim();
  if (value.length > EXTERNAL_URL_MAX_LENGTH || (value.length > 0 && !isSafeExternalUrl(value))) {
    return { status: "error" };
  }
  return { status: "ok", value: value.length === 0 ? null : value };
}
