export function buildManagedItemsHref(
  itemType: string | undefined,
  kind: string | undefined,
  q: string | undefined,
): string {
  const params = new URLSearchParams();
  if (kind !== undefined) params.set("kind", kind);
  if (itemType !== undefined) params.set("itemType", itemType);
  if (q !== undefined) params.set("q", q);
  const query = params.toString();
  return query === "" ? "/managed-items" : `/managed-items?${query}`;
}
