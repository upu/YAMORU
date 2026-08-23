export type ManagedItemClassificationOptions = {
  itemTypes: { code: string; kindCode: string; label: string }[];
  kinds: { code: string; label: string }[];
};

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
