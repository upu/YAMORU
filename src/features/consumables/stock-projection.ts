import { tokyoDateToUtcIso } from "../todos/projection/time-zone";
import { StockError, type StockApplication, type StockStatus } from "./stock-contract";

export type StockFact = {
  recordId: string; eventId: string; revision: number; kind: "observation" | "refill" | "state_snapshot";
  occurredOn: string | null; occurredAt: string | null; status: StockStatus; recordedAt: string;
  voided: boolean; rootSequence: number;
};
export type StockProjection = { recordId: string | null; status: StockStatus | null; effect: "applied" | "history_only" };

// snapshotは保存状態の捕捉時点。観測日として外へ返す値ではない。
function range(fact: StockFact): { start: number; end: number } | null {
  if (fact.kind === "state_snapshot") {
    const point = Date.parse(fact.recordedAt);
    return Number.isFinite(point) ? { start: point, end: point } : null;
  }
  if (fact.occurredAt !== null) {
    const point = Date.parse(fact.occurredAt);
    return Number.isFinite(point) ? { start: point, end: point } : null;
  }
  const day = fact.occurredOn === null ? null : tokyoDateToUtcIso(fact.occurredOn);
  if (day === null) return null;
  const start = Date.parse(day);
  // 記録までに起きたという上限だけを使い、記録時刻を発生時刻へ置き換えない。
  const end = Math.min(start + 86_400_000 - 1, Date.parse(fact.recordedAt));
  return Number.isFinite(end) && end >= start ? { start, end } : null;
}
function relativeTime(head: StockFact | null, next: StockFact): number {
  const before = head === null ? null : range(head);
  const after = range(next);
  if (before && after && after.start > before.end) return 1;
  if (before && after && after.end < before.start) return -1;
  return 0;
}
export function projectStockRecord(head: StockFact | null, next: StockFact, application: StockApplication, current: boolean): StockProjection {
  const unchanged: StockProjection = { recordId: head?.recordId ?? null, status: head?.status ?? null, effect: "history_only" };
  if (application === "history_only") return unchanged;
  if (current) return { recordId: next.recordId, status: next.status, effect: "applied" };
  const order = relativeTime(head, next);
  if (order > 0) return { recordId: next.recordId, status: next.status, effect: "applied" };
  if (order < 0) return unchanged;
  if (head?.status === next.status) return unchanged;
  throw new StockError("missing_required", "current_observation", "ambiguous_stock_order");
}

export function selectStockBasis(facts: StockFact[]): StockFact | null {
  const candidates = facts.filter((fact) => !fact.voided).flatMap((fact) => {
    const time = range(fact);
    return time === null ? [] : [{ fact, time }];
  });
  if (!candidates.length) return null;
  const newestStart = Math.max(...candidates.map(({ time }) => time.start));
  const frontier = candidates.filter(({ time }) => time.end >= newestStart);
  if (frontier.some(({ fact }) => fact.status !== frontier[0].fact.status)) throw new StockError("missing_required", "current_observation", "ambiguous_stock_order");
  frontier.sort((a, b) => b.time.start - a.time.start || b.fact.rootSequence - a.fact.rootSequence);
  return frontier[0].fact;
}
