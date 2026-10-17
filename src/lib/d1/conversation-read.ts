import type { EntityKind } from "../../features/integration/read-contract";
import { effectiveOccurrenceField as effective, taskRuleSnapshotExpression } from "./todos/rule-snapshot";
import { operationClientExpression, operationDatePrecisionExpression } from "./integration-operations";

export type EntityRow = {
  kind: EntityKind; id: string; name: string; related_name: string | null;
  created_at: string; data: string; aliases: string; key: string;
};
export type ReadVersion = { epoch: string; version: number; changed_at: string };

export async function readHouseholdVersion(db: D1Database, householdId: string): Promise<ReadVersion> {
  const row = await db.prepare("SELECT epoch,version,changed_at FROM household_read_versions WHERE household_id=?")
    .bind(householdId).first<ReadVersion>();
  if (row === null) throw new Error("Household read revision missing");
  return row;
}

const effectiveManagedId = effective("managedItemId", "r.managed_item_id");
const effectiveManagedName = effective("managedItemName", "i.name");
const ruleSnapshot = taskRuleSnapshotExpression();
const entityQueries: Record<EntityKind, string> = {
  managed_item: `SELECT 'managed_item' AS kind,m.id,m.name,NULL AS related_name,m.created_at,
    json_object('note',m.note,'product_info',m.product_info,'started_on',m.started_on,
      'kind_code',c.kind_code,'item_type_code',c.item_type_code,'custom_item_type',c.custom_item_type) AS data
    FROM managed_items m LEFT JOIN managed_item_classifications c ON c.managed_item_id=m.id AND c.household_id=m.household_id
    WHERE m.household_id=?1`,
  consumable: `SELECT 'consumable' AS kind,c.id,c.name,NULL AS related_name,c.created_at,
    json_object('note',c.note,'product_code',c.product_code,'stock_status',c.stock_status,
      'stock_revision',c.stock_revision,
      'stock_basis_record_id',(SELECT h.record_id FROM consumable_stock_heads h WHERE h.consumable_id=c.id AND h.household_id=c.household_id),
      'last_refilled_on',(SELECT max(f.occurred_on) FROM consumable_stock_current f WHERE f.consumable_id=c.id AND f.household_id=c.household_id AND f.kind='refill' AND f.voided=0
        AND date(f.occurred_on,'+0 days')=f.occurred_on)) AS data
    FROM consumables c WHERE c.household_id=?1`,
  todo_rule: `SELECT 'todo_rule' AS kind,r.id,r.title AS name,i.name AS related_name,r.created_at,
    json_object('note',r.note,'current_rule',json(${ruleSnapshot}),
      'current_occurrence_id',(SELECT o.id FROM task_occurrences o WHERE o.task_rule_id=r.id AND o.household_id=r.household_id AND o.status IN ('pending','completed')
        ORDER BY (o.status='pending') DESC,o.created_at DESC,o.id DESC LIMIT 1)) AS data
    FROM task_rules r LEFT JOIN managed_items i ON i.id=r.managed_item_id AND i.household_id=r.household_id WHERE r.household_id=?1`,
  todo_occurrence: `SELECT 'todo_occurrence' AS kind,o.id,${effective("title", "r.title")} AS name,
    ${effectiveManagedName} AS related_name,o.created_at,
    json_object('note',r.note,'task_rule_id',o.task_rule_id,'status',o.status,'assignee_user_id',o.assignee_user_id,
      'scheduled_for',o.scheduled_for,'due_at',o.due_at,'must_complete_by',o.must_complete_by,
      'managed_item_id',${effectiveManagedId},'deadline_kind',${effective("deadlineKind", "r.deadline_kind")},
      'recurrence_basis',${effective("recurrenceBasis", "r.recurrence_basis")},
      'occurrence_rule',json(CASE WHEN json_type(o.rule_snapshot,'$.title') IS NULL THEN ${ruleSnapshot} ELSE o.rule_snapshot END)) AS data
    FROM task_occurrences o JOIN task_rules r ON r.id=o.task_rule_id AND r.household_id=o.household_id
    LEFT JOIN managed_items i ON i.id=r.managed_item_id AND i.household_id=r.household_id WHERE o.household_id=?1`,
};

const aliases = `(SELECT json_group_array(alias) FROM entity_aliases a WHERE a.household_id=?1 AND
  ((e.kind='managed_item' AND a.managed_item_id=e.id) OR (e.kind='todo_rule' AND a.todo_rule_id=e.id)
   OR (e.kind='todo_occurrence' AND a.todo_occurrence_id=e.id) OR (e.kind='consumable' AND a.consumable_id=e.id)))`;

export async function readEntityRows(db: D1Database, householdId: string, kinds: EntityKind[], after: string, limit: number, id?: string): Promise<EntityRow[]> {
  const sql = `WITH e AS (${kinds.map((kind) => entityQueries[kind]).join(" UNION ALL ")})
    SELECT e.*,e.kind||':'||e.id AS key,${aliases} AS aliases FROM e
    WHERE (e.kind||':'||e.id)>?2 AND (?4 IS NULL OR e.id=?4) ORDER BY key LIMIT ?3`;
  return (await db.prepare(sql).bind(householdId, after, limit, id ?? null).all<EntityRow>()).results;
}

const relationQueries: Record<EntityKind, string> = {
  managed_item: `SELECT 'todo_rule' AS kind,r.id FROM task_rules r WHERE r.household_id=?1 AND r.managed_item_id=?2
    UNION SELECT 'consumable',m.consumable_id FROM managed_item_consumables m WHERE m.household_id=?1 AND m.managed_item_id=?2`,
  consumable: `SELECT 'managed_item' AS kind,m.managed_item_id AS id FROM managed_item_consumables m WHERE m.household_id=?1 AND m.consumable_id=?2
    UNION SELECT 'todo_rule',t.task_rule_id FROM task_rule_consumables t WHERE t.household_id=?1 AND t.consumable_id=?2`,
  todo_rule: `SELECT 'consumable' AS kind,t.consumable_id AS id FROM task_rule_consumables t WHERE t.household_id=?1 AND t.task_rule_id=?2
    UNION SELECT 'managed_item',r.managed_item_id FROM task_rules r WHERE r.household_id=?1 AND r.id=?2 AND r.managed_item_id IS NOT NULL
    UNION SELECT 'todo_occurrence',o.id FROM task_occurrences o WHERE o.household_id=?1 AND o.task_rule_id=?2`,
  todo_occurrence: `SELECT 'todo_rule' AS kind,o.task_rule_id AS id FROM task_occurrences o WHERE o.household_id=?1 AND o.id=?2
    UNION SELECT 'managed_item',${effectiveManagedId} FROM task_occurrences o JOIN task_rules r ON r.id=o.task_rule_id AND r.household_id=o.household_id
      WHERE o.household_id=?1 AND o.id=?2 AND ${effectiveManagedId} IS NOT NULL`,
};

export async function readEntityRelations(db: D1Database, householdId: string, kind: EntityKind, id: string) {
  const { results } = await db.prepare(`WITH relations AS (${relationQueries[kind]})
    SELECT kind,id FROM relations ORDER BY kind,id LIMIT 51`).bind(householdId, id).all<{ kind: EntityKind; id: string }>();
  return { items: results.slice(0, 50), has_more: results.length > 50, limit: 50 };
}

export type HistoryRow = {
  id: string; kind: string; occurrence_id: string | null; occurred_at: string | null;
  occurred_on: string | null; recorded_at: string; actor_user_id: string | null;
  performer_user_id: string | null; corrects_id: string | null; client_id: string | null;
  date_precision: string | null; data: string; key: string;
};

// Corrections remain independent events. Completion rows expose both original and effective values.
const effectiveTime = `coalesce((SELECT c.new_occurred_at FROM completion_corrections c WHERE c.completed_activity_log_id=l.id AND c.household_id=l.household_id AND c.new_occurred_at IS NOT NULL ORDER BY c.corrected_at DESC,c.id DESC LIMIT 1),l.occurred_at)`;
// 完了記録の実施日時の精度。最新の実施日時の訂正があればその訂正の精度
// (Webからの訂正なら'unknown')、なければ完了時の外部commandの精度を使う。
const effectivePrecision = `CASE WHEN l.action='completed' THEN coalesce(
  (SELECT coalesce(${operationDatePrecisionExpression("c", "$.payload.changes.date_precision")},'unknown') FROM completion_corrections c
    WHERE c.completed_activity_log_id=l.id AND c.household_id=l.household_id AND c.new_occurred_at IS NOT NULL
    ORDER BY c.corrected_at DESC,c.id DESC LIMIT 1),
  ${operationDatePrecisionExpression("l", "$.payload.date_precision")}) END`;
const effectivePerformer = `coalesce((SELECT c.new_performed_by_user_id FROM completion_corrections c WHERE c.completed_activity_log_id=l.id AND c.household_id=l.household_id AND c.new_performed_by_user_id IS NOT NULL ORDER BY c.corrected_at DESC,c.id DESC LIMIT 1),l.performed_by_user_id)`;

export async function readHistoryRows(db: D1Database, householdId: string, kind: EntityKind, id: string, after: string, limit: number): Promise<HistoryRow[]> {
  const sql = `WITH selected_occurrences AS (
    SELECT o.id FROM task_occurrences o JOIN task_rules r ON r.id=o.task_rule_id AND r.household_id=o.household_id
    WHERE o.household_id=?1 AND ((?2='todo_occurrence' AND o.id=?3) OR (?2='todo_rule' AND r.id=?3)
      OR (?2='managed_item' AND ${effectiveManagedId}=?3))
  ), history AS (
    SELECT l.id,l.action AS kind,l.task_occurrence_id AS occurrence_id,${effectiveTime} AS occurred_at,NULL AS occurred_on,
      l.recorded_at,l.actor_user_id,${effectivePerformer} AS performer_user_id,NULL AS corrects_id,
      ${operationClientExpression("l")} AS client_id,${effectivePrecision} AS date_precision,
      json_object('original_occurred_at',l.occurred_at,'original_performer_user_id',l.performed_by_user_id,
        'previous_due_at',l.previous_due_at,'new_due_at',l.new_due_at,
        'previous_assignee_user_id',l.previous_assignee_user_id,'new_assignee_user_id',l.new_assignee_user_id,
        'active',CASE WHEN l.action='completed' THEN EXISTS(SELECT 1 FROM task_occurrences active_o WHERE active_o.id=l.task_occurrence_id AND active_o.household_id=l.household_id AND active_o.status='completed')
          AND l.id=(SELECT latest.id FROM activity_logs latest WHERE latest.household_id=l.household_id AND latest.task_occurrence_id=l.task_occurrence_id AND latest.action='completed' ORDER BY latest.recorded_at DESC,latest.id DESC LIMIT 1) ELSE NULL END) AS data
    FROM activity_logs l WHERE l.household_id=?1 AND l.task_occurrence_id IN (SELECT id FROM selected_occurrences)
    UNION ALL
    SELECT c.id,'completion_corrected',c.task_occurrence_id,c.new_occurred_at,NULL,c.corrected_at,c.actor_user_id,c.new_performed_by_user_id,c.completed_activity_log_id,
      ${operationClientExpression("c")},
      CASE WHEN c.new_occurred_at IS NOT NULL THEN ${operationDatePrecisionExpression("c", "$.payload.changes.date_precision")} END,
      json_object('previous_occurred_at',c.previous_occurred_at,'previous_performer_user_id',c.previous_performed_by_user_id)
    FROM completion_corrections c WHERE c.household_id=?1 AND c.task_occurrence_id IN (SELECT id FROM selected_occurrences)
    UNION ALL
    SELECT c.id,'rule_changed',c.task_occurrence_id,NULL,NULL,c.changed_at,c.actor_user_id,NULL,NULL,NULL,NULL,
      json_object('previous_rule',json(c.previous_rule_snapshot),'new_rule',json(c.new_rule_snapshot))
    FROM task_rule_changes c WHERE c.household_id=?1 AND c.task_occurrence_id IN (SELECT id FROM selected_occurrences)
    UNION ALL
    SELECT d.id,'hard_deadline_changed',d.task_occurrence_id,NULL,NULL,d.recorded_at,d.actor_user_id,NULL,NULL,NULL,NULL,
      json_object('previous_date',d.previous_date,'new_date',d.new_date)
    FROM task_deadline_changes d WHERE d.household_id=?1 AND d.task_occurrence_id IN (SELECT id FROM selected_occurrences)
    UNION ALL
    SELECT CASE WHEN f.action='created' AND f.kind='refill' THEN f.refill_id ELSE f.id END,
      CASE WHEN f.action='voided' THEN 'stock_voided' WHEN f.action='corrected' THEN 'stock_corrected'
        WHEN f.kind='refill' THEN 'refilled' WHEN f.kind='observation' THEN 'stock_observed' ELSE 'stock_saved_state' END,
      NULL,f.occurred_at,CASE WHEN date(f.occurred_on,'+0 days')=f.occurred_on THEN f.occurred_on END,f.recorded_at,f.actor_user_id,f.performer_user_id,
      CASE WHEN f.action<>'created' THEN f.record_id END,${operationClientExpression("f")},
      CASE WHEN f.occurred_at IS NOT NULL THEN 'instant' WHEN date(f.occurred_on,'+0 days')=f.occurred_on THEN 'day' ELSE 'unknown' END,
      json_object('record_id',f.record_id,'record_revision',f.revision,'record_kind',f.kind,'stock_status',f.stock_status,'source',f.source,'original_occurred_on',f.occurred_on,
        'previous_event_id',f.previous_event_id,'effective_revision',c.revision,'effective_stock_status',c.stock_status,'effective_occurred_on',c.occurred_on,
        'effective_occurred_at',c.occurred_at,'voided',json(CASE WHEN c.voided=1 THEN 'true' ELSE 'false' END))
      FROM consumable_stock_events f JOIN consumable_stock_current c ON c.record_id=f.record_id
    WHERE f.household_id=?1 AND ?2='consumable' AND f.consumable_id=?3 AND f.kind<>'state_snapshot'
  ) SELECT *,recorded_at||':'||kind||':'||id AS key FROM history
    WHERE (?4='' OR (recorded_at||':'||kind||':'||id)<?4) ORDER BY key DESC LIMIT ?5`;
  return (await db.prepare(sql).bind(householdId, kind, id, after, limit).all<HistoryRow>()).results;
}
