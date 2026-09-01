import { getCurrentHouseholdId, requireHouseholdMembership, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";
import {
  MANAGED_ITEM_CLASSIFICATION_SELECT,
  OPTIONAL_ATTRIBUTE_SELECT,
  type ActivityLogRow,
  type ManagedItemDetailRow,
  type ManagedItemOptionalAttributes,
  type ManagedItemSummary,
  type TaskOccurrenceRow,
  type TaskRuleRow,
} from "./managed-items";

async function requireCurrentHousehold(db: D1Database, session: D1Session): Promise<string> {
  const householdId = await getCurrentHouseholdId(db, session);
  if (householdId === null) throw new D1NotFoundError("家庭が見つかりません。");
  await requireHouseholdMembership(db, session, householdId);
  return householdId;
}

type FlatOccurrence = Omit<TaskOccurrenceRow, "activity_logs"> & {
  task_rule_id: string;
};

type FlatLog = ActivityLogRow & { task_occurrence_id: string };

function attachActivityLogs(
  occurrences: FlatOccurrence[],
  logs: FlatLog[],
): Map<string, TaskOccurrenceRow[]> {
  const logsByOccurrence = new Map<string, ActivityLogRow[]>();
  for (const log of logs) {
    const current = logsByOccurrence.get(log.task_occurrence_id) ?? [];
    current.push(log);
    logsByOccurrence.set(log.task_occurrence_id, current);
  }
  const occurrencesByRule = new Map<string, TaskOccurrenceRow[]>();
  for (const occurrence of occurrences) {
    const current = occurrencesByRule.get(occurrence.task_rule_id) ?? [];
    current.push({
      activity_logs: logsByOccurrence.get(occurrence.id) ?? [],
      assignee_user_id: occurrence.assignee_user_id,
      due_at: occurrence.due_at,
      id: occurrence.id,
      scheduled_for: occurrence.scheduled_for,
      status: occurrence.status,
      title_snapshot: occurrence.title_snapshot,
    });
    occurrencesByRule.set(occurrence.task_rule_id, current);
  }
  return occurrencesByRule;
}

type ManagedItemDetailHead = ManagedItemSummary
  & ManagedItemOptionalAttributes
  & { household_id: string };

function loadManagedItemDetailHead(
  db: D1Database,
  id: string,
  householdId: string,
): Promise<ManagedItemDetailHead | null> {
  return db.prepare(
    `SELECT item.*, m.household_id, ${OPTIONAL_ATTRIBUTE_SELECT}
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.id = ?1 AND m.household_id = ?2) item
       JOIN managed_items m ON m.id = item.id`,
  ).bind(id, householdId).first<ManagedItemDetailHead>();
}

const DETAIL_RULES_SQL = `SELECT r.id, r.title, r.deadline_kind, r.recurrence_basis
  FROM task_rules r
 WHERE r.household_id = ?2
   AND (r.managed_item_id = ?1 OR EXISTS (
     SELECT 1 FROM task_occurrences o
      WHERE o.task_rule_id = r.id AND o.household_id = ?2
        AND json_extract(o.rule_snapshot, '$.managedItemId') = ?1
   ))
 ORDER BY r.created_at, r.id`;

const DETAIL_OCCURRENCES_SQL = `SELECT o.id, o.task_rule_id, o.status, o.scheduled_for,
       o.due_at, o.assignee_user_id,
       CASE WHEN json_type(o.rule_snapshot, '$.title') IS NULL
         THEN r.title ELSE json_extract(o.rule_snapshot, '$.title') END AS title_snapshot
  FROM task_occurrences o
  JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
 WHERE o.household_id = ?2
   AND (CASE WHEN json_type(o.rule_snapshot, '$.managedItemId') IS NULL
     THEN r.managed_item_id ELSE json_extract(o.rule_snapshot, '$.managedItemId') END) = ?1
 ORDER BY o.scheduled_for IS NOT NULL, o.scheduled_for, o.id`;

const DETAIL_LOGS_SQL = `SELECT l.id, l.task_occurrence_id, l.action,
       coalesce((SELECT c.new_occurred_at FROM completion_corrections c
         WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
           AND c.new_occurred_at IS NOT NULL
         ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1), l.occurred_at) AS occurred_at,
       l.recorded_at,
       coalesce((SELECT c.new_performed_by_user_id FROM completion_corrections c
         WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
           AND c.new_performed_by_user_id IS NOT NULL
         ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
         l.performed_by_user_id) AS performed_by_user_id
  FROM activity_logs l
  JOIN task_occurrences o ON o.id = l.task_occurrence_id AND o.household_id = l.household_id
  JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
 WHERE l.household_id = ?2
   AND (CASE WHEN json_type(o.rule_snapshot, '$.managedItemId') IS NULL
     THEN r.managed_item_id ELSE json_extract(o.rule_snapshot, '$.managedItemId') END) = ?1
 ORDER BY l.recorded_at, l.id`;

function loadDetailRelations(db: D1Database, id: string, householdId: string) {
  return Promise.all([
    db.prepare("SELECT id, url FROM external_links WHERE managed_item_id = ?1 AND household_id = ?2 ORDER BY created_at, id")
      .bind(id, householdId).all<{ id: string; url: string }>(),
    db.prepare(DETAIL_RULES_SQL).bind(id, householdId)
      .all<Omit<TaskRuleRow, "task_occurrences">>(),
    db.prepare(DETAIL_OCCURRENCES_SQL).bind(id, householdId).all<FlatOccurrence>(),
    db.prepare(DETAIL_LOGS_SQL).bind(id, householdId).all<FlatLog>(),
  ]);
}

export async function loadManagedItemDetail(
  db: D1Database,
  session: D1Session,
  id: string,
): Promise<ManagedItemDetailRow | null> {
  const householdId = await requireCurrentHousehold(db, session);
  const item = await loadManagedItemDetailHead(db, id, householdId);
  if (item === null) return null;
  const [links, rules, occurrences, logs] = await loadDetailRelations(db, id, householdId);
  const occurrencesByRule = attachActivityLogs(occurrences.results, logs.results);
  return {
    ...item,
    external_links: links.results,
    task_rules: rules.results.map((rule) => ({
      ...rule,
      task_occurrences: occurrencesByRule.get(rule.id) ?? [],
    })),
  };
}
