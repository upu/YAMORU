import {
  CUSTOM_ITEM_TYPE_MAX_LENGTH,
  MANAGED_ITEM_NAME_MAX_LENGTH,
  normalizeExternalUrl,
  normalizeOptionalText,
  normalizeRequiredText,
  NOTE_MAX_LENGTH,
  PRODUCT_INFO_MAX_LENGTH,
} from "../../../app/managed-items/form-input";
import { toStartedOn } from "../../../app/managed-items/started-on";
import { MANAGED_ITEM_TAG_MAX_COUNT } from "../../../lib/managed-items/tag-rules";
import { CommandError, invalidInput } from "./contract";
import { idValue, objectValue } from "./input";

// managed_item.createのpayloadを検証し、Webの登録フォームと同じ規則
// (form-input.ts・started-on.ts)で正規化する。分類が現在選べるものか、
// タグが同じ家庭のものかは、家庭のデータを読むplanで確かめる。

export type ManagedItemPayload = {
  custom_item_type: string | null;
  external_url: string | null;
  item_type: string | null;
  kind: string;
  name: string;
  note: string | null;
  product_info: string | null;
  started_on: string | null;
  tag_ids: string[];
};

export const MANAGED_ITEM_PAYLOAD_KEYS = [
  "name", "kind", "item_type", "custom_item_type", "product_info", "note", "external_url", "started_on", "tag_ids",
];

const STARTED_ON_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;

function missing(field: string): CommandError {
  return new CommandError("missing_required", { fieldErrors: { [field]: "required" } });
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw invalidInput(field, "string_required");
  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) throw missing(field);
  const text = normalizeRequiredText(optionalString(value, field), maxLength);
  if (text === null) throw invalidInput(field, "invalid_length");
  return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  const text = normalizeOptionalText(optionalString(value, field), maxLength);
  if (text.status !== "ok") throw invalidInput(field, "too_long");
  return text.value;
}

function externalUrl(value: unknown, field: string): string | null {
  const url = normalizeExternalUrl(optionalString(value, field));
  if (url.status !== "ok") throw invalidInput(field, "http_or_https_url_required");
  return url.value;
}

// 分かる精度だけの開始時期(年 / 年月 / 年月日)。Webの3つの入力欄と同じ
// 判定を通し、保存形と同じ書式だけを受け付ける。
function startedOn(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const match = typeof value === "string" ? STARTED_ON_PATTERN.exec(value) : null;
  // 省略した精度の組は、実行時にはundefinedになる。
  const [, year = "", month = "", day = ""] = match ?? [];
  const result = match === null ? null : toStartedOn({ day, month, year });
  if (result?.status !== "ok" || result.value !== value) throw invalidInput(field, "year_month_or_day_required");
  return result.value;
}

function tagIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidInput(field, "array_required");
  const ids = [...new Set(value.map((item) => idValue(item, field)))];
  if (ids.length > MANAGED_ITEM_TAG_MAX_COUNT) throw invalidInput(field, "too_many_tags");
  return ids;
}

function classification(value: Record<string, unknown>, field: string) {
  if (value.kind === undefined || value.kind === null) throw missing(`${field}.kind`);
  if (typeof value.kind !== "string" || value.kind.length === 0) throw invalidInput(`${field}.kind`, "string_required");
  const hasItemType = value.item_type !== undefined && value.item_type !== null;
  const hasCustom = value.custom_item_type !== undefined && value.custom_item_type !== null;
  if (hasItemType && hasCustom) throw invalidInput(field, "item_type_or_custom_item_type");
  return {
    custom_item_type: hasCustom
      ? requiredText(value.custom_item_type, `${field}.custom_item_type`, CUSTOM_ITEM_TYPE_MAX_LENGTH)
      : null,
    item_type: hasItemType ? idValue(value.item_type, `${field}.item_type`) : null,
    kind: value.kind,
  };
}

export function managedItemPayload(payload: unknown, field = "payload"): ManagedItemPayload {
  const value = objectValue(payload ?? {}, field, MANAGED_ITEM_PAYLOAD_KEYS);
  return {
    ...classification(value, field),
    external_url: externalUrl(value.external_url, `${field}.external_url`),
    name: requiredText(value.name, `${field}.name`, MANAGED_ITEM_NAME_MAX_LENGTH),
    note: optionalText(value.note, `${field}.note`, NOTE_MAX_LENGTH),
    product_info: optionalText(value.product_info, `${field}.product_info`, PRODUCT_INFO_MAX_LENGTH),
    started_on: startedOn(value.started_on, `${field}.started_on`),
    tag_ids: tagIds(value.tag_ids, `${field}.tag_ids`),
  };
}
