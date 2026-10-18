import { z } from "zod";
import { EventSubscriptionError } from "./event-errors";
const kinds = ["todo_occurrence", "consumable"] as const;
const ids = z.array(z.string().min(1).max(200)).min(1).max(50);
export const eventFilterSchema = z.strictObject({ kinds: z.array(z.enum(kinds)).min(1).max(50).optional(), todo_rule_ids: ids.optional(), consumable_ids: ids.optional() });
export type EventFilter = { kinds: (typeof kinds[number])[]; todo_rule_ids?: string[]; consumable_ids?: string[] };
const unique = (values: string[] | undefined) => values === undefined ? undefined : [...new Set(values)].sort();
function selectedKinds(raw: z.infer<typeof eventFilterSchema>) {
  let selected = [...new Set(raw.kinds ?? kinds)];
  if (raw.todo_rule_ids && !selected.includes("todo_occurrence")) throw new EventSubscriptionError("invalid_input", "filter_conflict");
  if (raw.consumable_ids && !selected.includes("consumable")) throw new EventSubscriptionError("invalid_input", "filter_conflict");
  const targets: typeof selected = [];
  if (raw.todo_rule_ids) targets.push("todo_occurrence");
  if (raw.consumable_ids) targets.push("consumable");
  if (targets.length) selected = selected.filter((kind) => targets.includes(kind));
  return selected.sort();
}
export function normalizeEventFilter(value: unknown): EventFilter {
  const parsed = eventFilterSchema.safeParse(value ?? {});
  if (!parsed.success) throw new EventSubscriptionError("invalid_input", "filter_schema");
  const raw = parsed.data;
  const todo = unique(raw.todo_rule_ids);
  const stock = unique(raw.consumable_ids);
  return { kinds: selectedKinds(raw), ...(todo ? { todo_rule_ids: todo } : {}), ...(stock ? { consumable_ids: stock } : {}) };
}
export function eventFilterMatches(filter: EventFilter, source: { kind: typeof kinds[number]; entityId: string; todoRuleId: string | null }) {
  if (!filter.kinds.includes(source.kind)) return false;
  if (filter.todo_rule_ids === undefined && filter.consumable_ids === undefined) return true;
  if (source.kind === "todo_occurrence") return source.todoRuleId !== null && filter.todo_rule_ids?.includes(source.todoRuleId) === true;
  return filter.consumable_ids?.includes(source.entityId) === true;
}
