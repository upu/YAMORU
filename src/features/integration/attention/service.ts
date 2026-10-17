import { requireHouseholdMembership } from "../../../lib/d1/authorization";
import { D1ForbiddenError, D1UnauthorizedError } from "../../../lib/d1/errors";
import { readHouseholdVersion } from "../../../lib/d1/conversation-read";
import { attentionPage, attentionSequence, candidateOutput, nextAttentionCheck, refreshAttention, type AttentionCandidate } from "../../../lib/d1/attention";
import { formatTokyoDateInput } from "../../todos/projection/time-zone";
import { ReadError, limitInput, objectInput, stringInput } from "../read-contract";
import { createReadCursor, cursorScope } from "../read-cursor";
import type { ReadDependencies } from "../read";

type Position = { phase: "refresh" | "page" | "sync"; after: string; since: number | null; until: number; version: string; epoch: string; day: string; expires: number };
type Context = Awaited<ReturnType<typeof begin>>;

function inputValue(input: unknown) {
  const value = objectInput(input, ["cursor", "limit", "candidate_ids"]);
  let ids: string[] | null = null;
  if (value.candidate_ids !== undefined) {
    if (!Array.isArray(value.candidate_ids) || !value.candidate_ids.length || value.candidate_ids.length > 50) throw new ReadError("invalid_input");
    ids = [...new Set(value.candidate_ids.map((id: unknown) => stringInput(id)))].sort();
  }
  return { limit: limitInput(value.limit), ids, cursor: value.cursor };
}

async function authorize(deps: ReadDependencies) {
  try {
    const principal = await deps.authorize();
    if (!principal.scopes.includes("household.read")) throw new ReadError("insufficient_scope");
    await requireHouseholdMembership(deps.db, { userId: principal.userId }, principal.householdId);
    return principal;
  } catch (error) {
    if (error instanceof D1ForbiddenError) throw new ReadError("forbidden");
    if (error instanceof D1UnauthorizedError) throw new ReadError("unauthenticated");
    throw error;
  }
}

async function begin(deps: ReadDependencies, input: ReturnType<typeof inputValue>) {
  const principal = await authorize(deps);
  const now = deps.now?.() ?? new Date();
  const version = await readHouseholdVersion(deps.db, principal.householdId);
  const day = formatTokyoDateInput(now.toISOString());
  const stamp = JSON.stringify([version.epoch, version.version]);
  const cursor = createReadCursor(deps.cursorSecret);
  const scope = cursorScope(principal, ["attention", input.limit, input.ids]);
  const decoded = await cursor.decode(input.cursor, scope, now);
  const position: Position = decoded ? JSON.parse(decoded) as Position : { phase: "refresh", after: "", since: null, until: 0, version: stamp, epoch: version.epoch, day, expires: now.getTime() + 900_000 };
  if (position.expires <= now.getTime()) throw new ReadError("cursor_expired");
  if (position.epoch !== version.epoch) throw new ReadError("invalid_cursor");
  if (position.phase !== "sync" && (position.version !== stamp || position.day !== day)) throw new ReadError("invalid_cursor");
  if (position.phase === "sync") Object.assign(position, { phase: "refresh", since: position.until, after: "", version: stamp, day });
  return { principal, now, version, stamp, day, cursor, scope, position };
}

async function finish(deps: ReadDependencies, context: Context, sequence: number | null) {
  const principal = await authorize(deps);
  if (cursorScope(principal, []) !== cursorScope(context.principal, [])) throw new ReadError("forbidden");
  const latest = await readHouseholdVersion(deps.db, principal.householdId);
  if (JSON.stringify([latest.epoch, latest.version]) !== context.stamp) throw new ReadError("read_conflict");
  if (formatTokyoDateInput((deps.now?.() ?? new Date()).toISOString()) !== context.day) throw new ReadError("read_conflict");
  if (sequence !== null && await attentionSequence(deps.db, principal.householdId) !== sequence) throw new ReadError("read_conflict");
}

async function getPage(deps: ReadDependencies, context: Context, input: ReturnType<typeof inputValue>) {
  const { principal, now, position, cursor, scope } = context;
  if (position.phase === "refresh") {
    const after = await refreshAttention(deps.db, principal.householdId, context.version, now, position.after);
    if (after !== null) {
      await finish(deps, context, null);
      return { candidates: [] as AttentionCandidate[], removed_ids: [] as string[], refresh_complete: false,
        next_cursor: await cursor.encode(scope, JSON.stringify({ ...position, after }), now), sync_cursor: null };
    }
    Object.assign(position, { phase: "page", after: "", until: await attentionSequence(deps.db, principal.householdId) });
  }
  if (await attentionSequence(deps.db, principal.householdId) !== position.until) throw new ReadError("invalid_cursor");
  const rows = await attentionPage(deps.db, principal.householdId, position.since, position.until, position.after, input.limit, input.ids);
  const page = rows.slice(0, input.limit);
  await finish(deps, context, position.until);
  const more = rows.length > input.limit;
  return { candidates: page.filter((row) => !row.removed).map((row) => candidateOutput(row, now)),
    removed_ids: page.filter((row) => row.removed).map((row) => row.id), refresh_complete: true,
    next_cursor: more ? await cursor.encode(scope, JSON.stringify({ ...position, after: page[page.length - 1].page_key }), now) : null,
    sync_cursor: more ? null : await cursor.encode(scope, JSON.stringify({ ...position, phase: "sync", after: "", expires: now.getTime() + 900_000 }), now) };
}

export function createAttentionReader(deps: ReadDependencies) {
  return {
    async attentionGet(raw: unknown) {
      const input = inputValue(raw);
      const context = await begin(deps, input);
      const result = await getPage(deps, context, input);
      return { schema_version: 1 as const, request_id: crypto.randomUUID(), as_of: context.now.toISOString(), generated_at: context.now.toISOString(),
        next_check_at: nextAttentionCheck(context.now), ...result };
    },
  };
}
