import type { AttentionPayload, AttentionSource } from "../../features/integration/attention/projection";
import { projectAttention } from "../../features/integration/attention/projection";
import { formatTokyoDateInput } from "../../features/todos/projection/time-zone";
import { ReadError } from "../../features/integration/read-contract";
import type { ReadVersion } from "./conversation-read";

export type StoredCandidate = { id: string; payload: string; revision: number; generated_at: string; sort_key: string };
export type AttentionCandidate = AttentionPayload & { candidate_id: string; revision: string; generated_at: string; next_check_at: string };
export function nextAttentionCheck(now: Date) {
  const nextDay = Date.parse(`${formatTokyoDateInput(now.toISOString())}T00:00:00+09:00`) + 86_400_000;
  return new Date(Math.min(now.getTime() + 300_000, nextDay)).toISOString();
}
export function candidateOutput(row: StoredCandidate, now: Date): AttentionCandidate {
  return { ...JSON.parse(row.payload) as AttentionPayload, candidate_id: row.id,
    revision: JSON.stringify([1, row.id, row.revision]), generated_at: row.generated_at, next_check_at: nextAttentionCheck(now) };
}

function candidateWrites(db: D1Database, household: string, sources: AttentionSource[], now: Date) {
  const rows = JSON.stringify(sources.map((source) => ({ id: crypto.randomUUID(), source_key: `${source.kind}:${source.id}`,
    occurrence_id: source.kind === "todo_occurrence" ? source.id : null,
    consumable_id: source.kind === "consumable" ? source.id : null, payload: projectAttention(source, now) })));
  const remove = db.prepare(`DELETE FROM attention_candidates WHERE household_id=? AND source_key IN (
    SELECT json_extract(value,'$.source_key') FROM json_each(?) WHERE json_type(value,'$.payload')='null')`).bind(household, rows);
  const upsert = db.prepare(`INSERT INTO attention_candidates(id,household_id,occurrence_id,consumable_id,source_key,payload,sort_key,generated_at,evaluated_on)
    SELECT json_extract(value,'$.id'),?1,json_extract(value,'$.occurrence_id'),json_extract(value,'$.consumable_id'),
      json_extract(value,'$.source_key'),json_extract(value,'$.payload'),json_extract(value,'$.payload.sort_key'),?2,?3
    FROM json_each(?4) WHERE json_type(value,'$.payload')='object'
    ON CONFLICT(household_id,source_key) DO UPDATE SET
    payload=excluded.payload,sort_key=excluded.sort_key,revision=attention_candidates.revision+1,
    generated_at=excluded.generated_at,evaluated_on=excluded.evaluated_on WHERE attention_candidates.payload<>excluded.payload`)
    .bind(household, now.toISOString(), formatTokyoDateInput(now.toISOString()), rows);
  return [remove, upsert];
}

export async function refreshAttention(db: D1Database, household: string, version: ReadVersion, now: Date, after: string) {
  const today = formatTokyoDateInput(now.toISOString());
  const ready = await db.prepare("SELECT 1 FROM attention_refresh WHERE household_id=? AND epoch=? AND version=? AND evaluated_on=?")
    .bind(household, version.epoch, version.version, today).first();
  if (ready) return null;
  const rows = (await db.prepare(`SELECT * FROM attention_eligibility s WHERE household_id=? AND (kind||':'||id)>?
    AND (eligible_on<=? OR EXISTS(SELECT 1 FROM attention_candidates c WHERE c.household_id=s.household_id AND c.source_key=s.kind||':'||s.id))
    ORDER BY kind,id LIMIT 101`).bind(household, after, today).all<AttentionSource>()).results;
  const page = rows.slice(0, 100);
  const guardId = crypto.randomUUID();
  const guard = db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN EXISTS(
    SELECT 1 FROM household_read_versions WHERE household_id=?2 AND epoch=?3 AND version=?4)
    AND NOT EXISTS(SELECT 1 FROM attention_refresh WHERE household_id=?2 AND evaluated_on>?5)
    AND NOT EXISTS(SELECT 1 FROM attention_candidates WHERE household_id=?2 AND evaluated_on>?5)
    THEN 1 ELSE 0 END`).bind(guardId, household, version.epoch, version.version, today);
  const finish = db.prepare(`INSERT INTO attention_refresh(household_id,epoch,version,evaluated_on) VALUES(?,?,?,?)
    ON CONFLICT(household_id) DO UPDATE SET epoch=excluded.epoch,version=excluded.version,evaluated_on=excluded.evaluated_on`)
    .bind(household, version.epoch, version.version, today);
  const prune = db.prepare(`DELETE FROM attention_changes WHERE sequence IN (
    SELECT sequence FROM attention_changes WHERE household_id=? AND recorded_at<?
    AND sequence<(SELECT max(sequence) FROM attention_changes WHERE household_id=?) ORDER BY sequence LIMIT 100)`)
    .bind(household, new Date(now.getTime() - 86_400_000).toISOString(), household);
  try {
    await db.batch([guard, ...candidateWrites(db, household, page, now),
      ...(rows.length <= 100 ? [finish, prune] : []), db.prepare("DELETE FROM attention_guards WHERE id=?").bind(guardId)]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("CHECK constraint failed: valid=1")) throw new ReadError("read_conflict");
    throw error;
  }
  return rows.length > 100 ? `${page[page.length - 1].kind}:${page[page.length - 1].id}` : null;
}

export async function attentionSequence(db: D1Database, household: string): Promise<number> {
  const row = await db.prepare("SELECT coalesce(max(sequence),0) AS value FROM attention_changes WHERE household_id=?").bind(household).first<{ value: number }>();
  return row?.value ?? 0;
}

export type AttentionChangeRow = StoredCandidate & { removed: number; page_key: string };
export async function attentionPage(db: D1Database, household: string, since: number | null, until: number, after: string, limit: number, ids: string[] | null) {
  const rows = await db.prepare(`WITH changed AS (
    SELECT candidate_id FROM attention_changes WHERE household_id=?1 AND sequence>?2 AND sequence<=?3 GROUP BY candidate_id
  ), entries AS (
    SELECT c.id,c.payload,c.revision,c.generated_at,c.sort_key,0 AS removed,c.sort_key AS page_key FROM attention_candidates c
      WHERE c.household_id=?1 AND (?2 IS NULL OR c.id IN (SELECT candidate_id FROM changed))
    UNION ALL
    SELECT candidate_id,'{}',0,'','',1,'9:'||candidate_id FROM changed
      WHERE NOT EXISTS(SELECT 1 FROM attention_candidates c WHERE c.household_id=?1 AND c.id=changed.candidate_id)
  ) SELECT * FROM entries WHERE page_key>?4 AND (?6 IS NULL OR id IN (SELECT value FROM json_each(?6))) ORDER BY page_key LIMIT ?5`)
    .bind(household, since, until, after, limit + 1, ids === null ? null : JSON.stringify(ids)).all<AttentionChangeRow>();
  return rows.results;
}
