export const MANAGED_ITEM_KINDS = [
  "pet_supplies",
  "appliance",
  "housing_equipment",
  "contract",
  "other",
] as const;

export type ManagedItemKind = (typeof MANAGED_ITEM_KINDS)[number];

export const MANAGED_ITEM_KIND_LABELS: Record<ManagedItemKind, string> = {
  appliance: "家電",
  contract: "契約",
  housing_equipment: "住宅設備",
  other: "その他",
  pet_supplies: "ペット用品",
};

export function isManagedItemKind(value: string): value is ManagedItemKind {
  return MANAGED_ITEM_KINDS.some((kind) => kind === value);
}

// managed_items.kindはCHECK制約付きのtextであり、生成された型では`string`になる
// D1のmanaged_items.kind。DBから読んだ値をこのunionへ落とす際に、
// 制約とMANAGED_ITEM_KINDSのズレを黙って通さず、その場で失敗させる。
export function toManagedItemKind(value: string): ManagedItemKind {
  if (!isManagedItemKind(value)) {
    throw new Error(`未知の管理対象の種類です: ${value}`);
  }

  return value;
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
