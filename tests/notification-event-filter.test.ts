import { expect, it } from "vitest";
import { normalizeEventFilter, eventFilterMatches } from "../src/features/integration/notifications/event-filter";
it("順序・重複と省略表現を同じ購読条件へ正規化する", () => {
  expect(normalizeEventFilter({ kinds: ["consumable", "todo_occurrence", "consumable"] })).toEqual(normalizeEventFilter({}));
  expect(normalizeEventFilter({ todo_rule_ids: ["b", "a", "b"] })).toEqual(normalizeEventFilter({ kinds: ["todo_occurrence"], todo_rule_ids: ["a", "b"] }));
});
it("ID指定を他の種類の全件監視へ広げず、次回Occurrenceは同じruleで追跡する", () => {
  const filter = normalizeEventFilter({ todo_rule_ids: ["rule-a"] });
  expect(eventFilterMatches(filter, { kind: "todo_occurrence", entityId: "first", todoRuleId: "rule-a" })).toBe(true);
  expect(eventFilterMatches(filter, { kind: "todo_occurrence", entityId: "next", todoRuleId: "rule-a" })).toBe(true);
  expect(eventFilterMatches(filter, { kind: "todo_occurrence", entityId: "other", todoRuleId: "rule-b" })).toBe(false);
  expect(eventFilterMatches(filter, { kind: "consumable", entityId: "stock-a", todoRuleId: null })).toBe(false);
  const stock = normalizeEventFilter({ consumable_ids: ["stock-a"] });
  expect(eventFilterMatches(stock, { kind: "consumable", entityId: "stock-a", todoRuleId: null })).toBe(true);
});
it("種類と対象の矛盾、空の対象、未知の境界指定、過大な条件を拒否する", () => {
  for (const value of [{ kinds: [] }, { todo_rule_ids: [] }, { kinds: ["consumable"], todo_rule_ids: ["a"] }, { household_id: "household-b" }, { consumable_ids: Array.from({ length: 51 }, (_value, index) => String(index)) }]) expect(() => normalizeEventFilter(value)).toThrow();
});
