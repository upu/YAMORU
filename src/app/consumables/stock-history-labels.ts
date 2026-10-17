import { formatTokyoDate, tokyoDateToUtcIso } from "../time-zone";
export function stockRecordedLabel(at: string) {
  if (!Number.isFinite(Date.parse(at))) return "記録日時不明";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(at));
}
export function stockOccurredLabel(on: string | null, at: string | null) {
  if (at && Number.isFinite(Date.parse(at))) return stockRecordedLabel(at);
  const date = on === null ? null : tokyoDateToUtcIso(on);
  return date === null ? "観測日不明" : formatTokyoDate(date);
}
export function stockSourceLabel(source: "unknown" | "web" | "integration", clientId: string | null) {
  if (source === "unknown") return "記録元不明";
  if (source === "web") return "YAMORU画面";
  return clientId ? `外部連携（${clientId}）` : "外部連携";
}
