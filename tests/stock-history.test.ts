import { expect, it } from "vitest";
import { stockMoment } from "../src/features/consumables/stock-contract";
import { projectStockRecord, selectStockBasis, type StockFact } from "../src/features/consumables/stock-projection";

const now = new Date("2026-10-18T03:00:00.000Z");
const fact = (id: string, on: string, status: StockFact["status"], at: string | null = null): StockFact => ({
  recordId: id, eventId: id, revision: 0, kind: "observation", occurredOn: on, occurredAt: at, status,
  recordedAt: now.toISOString(), voided: false, rootSequence: 1,
});
const head = fact("head", "2026-10-17", "low", "2026-10-17T03:00:00.000Z");

it("在庫の日付・時刻を区別し、今は基準時刻へ固定する", () => {
  expect(stockMoment("2026-10-17", undefined, now)).toEqual({ on: "2026-10-17", at: null, current: false });
  expect(stockMoment(undefined, "2026-10-18T10:00+09:00", now)).toEqual({ on: "2026-10-18", at: "2026-10-18T01:00:00.000Z", current: false });
  expect(stockMoment(undefined, "now", now)).toEqual({ on: "2026-10-18", at: now.toISOString(), current: true });
});
it.each([
  ["2026-02-30", undefined], ["2026-99-99", undefined], ["2026-10-19", undefined],
  [undefined, "2026-10-18T03:00:01Z"], [undefined, "2026-02-30T10:00Z"],
  [undefined, "2026-10-18T03:00"], ["2026-10-17", "now"], [undefined, undefined],
])("不正・未来・曖昧な日時を拒否する(%j,%j)", (on, at) => {
  expect(() => stockMoment(on, at, now)).toThrow();
});
it("古い観測は履歴だけにし、より新しい日付だけを自動反映する", () => {
  const before = fact("before", "2026-10-16", "available");
  const after = fact("after", "2026-10-18", "out");
  expect(projectStockRecord(head, before, "auto", false)).toMatchObject({ recordId: "head", status: "low", effect: "history_only" });
  expect(projectStockRecord(head, after, "auto", false)).toMatchObject({ recordId: "after", status: "out", effect: "applied" });
});
it("同日の異なる状態を記録時刻の順に決めず、必要な値を求める", () => {
  const ambiguous = fact("ambiguous", "2026-10-17", "out");
  expect(() => projectStockRecord(head, ambiguous, "auto", false)).toThrow(expect.objectContaining({ code: "missing_required" }));
  expect(projectStockRecord(head, ambiguous, "history_only", false)).toMatchObject({ status: "low", effect: "history_only" });
});
it("明示した現在の観測は反映し、履歴だけの指定は将来側の日付でも守る", () => {
  const current = fact("current", "2026-10-18", "out", now.toISOString());
  expect(projectStockRecord(head, current, "auto", true)).toMatchObject({ recordId: "current", status: "out", effect: "applied" });
  expect(projectStockRecord(head, current, "history_only", true)).toMatchObject({ recordId: "head", effect: "history_only" });
});
it("同日の同じ状態なら状態を推測せず履歴を追加できる", () => {
  expect(projectStockRecord(head, fact("same", "2026-10-17", "low"), "auto", false)).toMatchObject({ recordId: "head", effect: "history_only" });
});
it("訂正後は残る有効な事実だけから一意の状態を選ぶ", () => {
  const newer = fact("newer", "2026-10-18", "out", now.toISOString());
  expect(selectStockBasis([head, { ...newer, voided: true }])).toMatchObject({ recordId: "head", status: "low" });
  expect(selectStockBasis([head, newer])).toMatchObject({ recordId: "newer", status: "out" });
  expect(() => selectStockBasis([head, fact("unordered", "2026-10-17", "out")])).toThrow(expect.objectContaining({ code: "missing_required" }));
});
it("旧形式の不正な日付を観測日として解釈しない", () => {
  expect(selectStockBasis([head, { ...fact("invalid", "2026-99-99", "out"), kind: "refill" }])).toMatchObject({ recordId: "head" });
});
