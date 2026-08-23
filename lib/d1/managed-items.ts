import { getCurrentHouseholdId, requireHouseholdMembership, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";

export type ManagedItemSummary = { id: string; kind: string; name: string };
export type ActivityLogRow = {
  action: string;
  id: string;
  occurred_at: string;
  performed_by_user_id: string | null;
  recorded_at: string;
};
export type TaskOccurrenceRow = {
  activity_logs: ActivityLogRow[];
  assignee_user_id: string | null;
  due_at: string;
  id: string;
  scheduled_for: string;
  status: string;
};
export type TaskRuleRow = {
  deadline_kind: string;
  id: string;
  recurrence_basis: string;
  task_occurrences: TaskOccurrenceRow[];
  title: string;
};
export type ManagedItemDetailRow = ManagedItemSummary & {
  external_links: { id: string; url: string }[];
  household_id: string;
  task_rules: TaskRuleRow[];
};

async function requireCurrentHousehold(db: D1Database, session: D1Session): Promise<string> {
  const householdId = await getCurrentHouseholdId(db, session);
  if (householdId === null) throw new D1NotFoundError("家庭が見つかりません。");
  await requireHouseholdMembership(db, session, householdId);
  return householdId;
}

export async function listManagedItems(db: D1Database, session: D1Session): Promise<ManagedItemSummary[]> {
  const householdId = await requireCurrentHousehold(db, session);
  const { results } = await db.prepare("SELECT id, name, kind FROM managed_items WHERE household_id = ?1 ORDER BY created_at DESC, id DESC")
    .bind(householdId).all<ManagedItemSummary>();
  return results;
}

export async function createManagedItem(db: D1Database, session: D1Session, input: { externalUrl: string | null; kind: string; name: string }): Promise<string> {
  const householdId = await requireCurrentHousehold(db, session);
  const itemId = crypto.randomUUID();
  const statements = [db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES (?1, ?2, ?3, ?4)")
    .bind(itemId, householdId, input.name, input.kind)];
  if (input.externalUrl !== null) statements.push(db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), householdId, itemId, input.externalUrl));
  await db.batch(statements);
  return itemId;
}

export async function getManagedItem(db: D1Database, session: D1Session, id: string): Promise<ManagedItemSummary | null> {
  const householdId = await requireCurrentHousehold(db, session);
  return db.prepare("SELECT id, name, kind FROM managed_items WHERE id = ?1 AND household_id = ?2")
    .bind(id, householdId).first<ManagedItemSummary>();
}

export async function getManagedItemHouseholdId(db: D1Database, session: D1Session, id: string): Promise<string> {
  const householdId = await requireCurrentHousehold(db, session);
  const item = await db.prepare("SELECT id FROM managed_items WHERE id = ?1 AND household_id = ?2")
    .bind(id, householdId).first();
  if (item === null) throw new D1NotFoundError("管理対象が見つかりません。");
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
    });
    occurrencesByRule.set(occurrence.task_rule_id, current);
  }
  return occurrencesByRule;
}

export async function loadManagedItemDetail(
  db: D1Database,
  session: D1Session,
  id: string,
): Promise<ManagedItemDetailRow | null> {
  const householdId = await requireCurrentHousehold(db, session);
  const item = await db.prepare(
    "SELECT id, household_id, name, kind FROM managed_items WHERE id = ?1 AND household_id = ?2",
  ).bind(id, householdId).first<ManagedItemSummary & { household_id: string }>();
  if (item === null) return null;
  const [links, rules, occurrences, logs] = await Promise.all([
    db.prepare("SELECT id, url FROM external_links WHERE managed_item_id = ?1 AND household_id = ?2 ORDER BY created_at, id")
      .bind(id, householdId).all<{ id: string; url: string }>(),
    db.prepare("SELECT id, title, deadline_kind, recurrence_basis FROM task_rules WHERE managed_item_id = ?1 AND household_id = ?2 ORDER BY created_at, id")
      .bind(id, householdId).all<Omit<TaskRuleRow, "task_occurrences">>(),
    db.prepare(
      `SELECT o.id, o.task_rule_id, o.status, o.scheduled_for, o.due_at, o.assignee_user_id
         FROM task_occurrences o
         JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
        WHERE r.managed_item_id = ?1 AND o.household_id = ?2
        ORDER BY o.scheduled_for, o.id`,
    ).bind(id, householdId).all<FlatOccurrence>(),
    db.prepare(
      // #148: completedの行はcompletion_correctionsに訂正があれば有効値へ
      // 差し替える(YDR-026)。元のl.occurred_at/l.performed_by_user_id自体は
      // 書き換えない。corrected_activity_log_idはcompleted行しか参照しない
      // ため、他actionの行では相関サブクエリが常にNULLになりl側の値へ
      // フォールバックする。
      `SELECT l.id, l.task_occurrence_id, l.action,
              coalesce(
                (SELECT c.new_occurred_at FROM completion_corrections c
                   WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
                     AND c.new_occurred_at IS NOT NULL
                   ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
                l.occurred_at
              ) AS occurred_at,
              l.recorded_at,
              coalesce(
                (SELECT c.new_performed_by_user_id FROM completion_corrections c
                   WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
                     AND c.new_performed_by_user_id IS NOT NULL
                   ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
                l.performed_by_user_id
              ) AS performed_by_user_id
         FROM activity_logs l
         JOIN task_occurrences o ON o.id = l.task_occurrence_id AND o.household_id = l.household_id
         JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
        WHERE r.managed_item_id = ?1 AND l.household_id = ?2
        ORDER BY l.recorded_at, l.id`,
    ).bind(id, householdId).all<FlatLog>(),
  ]);
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
