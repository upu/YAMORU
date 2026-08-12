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
