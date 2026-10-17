import { requireHouseholdMembership } from "../../lib/d1/authorization";
import { D1ForbiddenError, D1UnauthorizedError } from "../../lib/d1/errors";
import { readEntityRelations, readEntityRows, readHistoryRows, readHouseholdVersion, type EntityRow, type ReadVersion } from "../../lib/d1/conversation-read";
import { ENTITY_KINDS, ReadError, kindInput, limitInput, matchEntity, normalizeEntityText, objectInput, stringInput, toWireValue, type EntityKind, type MatchReason, type ReadPrincipal } from "./read-contract";
import { createReadCursor, cursorScope } from "./read-cursor";
import { entityProjection, entitySummary } from "./read-projection";

export type ReadDependencies = {
  db: D1Database;
  // #436 adapter must revalidate grant, token expiry and scopes on every call.
  authorize: () => Promise<ReadPrincipal>;
  cursorSecret: string;
  now?: () => Date;
};
type ReadContext = { principal: ReadPrincipal; version: ReadVersion; now: Date };

function searchInput(input: unknown) {
  const value = objectInput(input, ["query", "kinds", "cursor", "limit"]);
  const query = normalizeEntityText(stringInput(value.query));
  if (!query) throw new ReadError("invalid_input");
  let kinds: EntityKind[] = [...ENTITY_KINDS].sort();
  if (value.kinds !== undefined) {
    if (!Array.isArray(value.kinds) || !value.kinds.length || value.kinds.length > 4) throw new ReadError("invalid_input");
    kinds = [...new Set(value.kinds.map(kindInput))].sort();
  }
  return { query, kinds, cursor: value.cursor, limit: limitInput(value.limit) };
}

async function authorized(deps: ReadDependencies): Promise<ReadPrincipal> {
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

async function consistentRead<T>(deps: ReadDependencies, run: (context: ReadContext) => Promise<T>) {
  const principal = await authorized(deps);
  const now = deps.now?.() ?? new Date();
  const version = await readHouseholdVersion(deps.db, principal.householdId);
  const result = await run({ principal, version, now });
  const latestPrincipal = await authorized(deps);
  if (cursorScope(latestPrincipal, []) !== cursorScope(principal, [])) throw new ReadError("forbidden");
  const latest = await readHouseholdVersion(deps.db, principal.householdId);
  if (latest.epoch !== version.epoch || latest.version !== version.version) throw new ReadError("read_conflict");
  return { schema_version: 1 as const, request_id: crypto.randomUUID(), as_of: now.toISOString(), ...result };
}

async function requiredEntity(deps: ReadDependencies, context: ReadContext, kind: EntityKind, id: string): Promise<EntityRow> {
  const row = (await readEntityRows(deps.db, context.principal.householdId, [kind], "", 1, id)).at(0);
  if (!row) throw new ReadError("not_found");
  return row;
}

async function searchPage(deps: ReadDependencies, context: ReadContext, input: ReturnType<typeof searchInput>) {
  const cursor = createReadCursor(deps.cursorSecret);
  const scope = cursorScope(context.principal, ["search", input.query, input.kinds, input.limit, context.version.epoch, context.version.version]);
  const after = await cursor.decode(input.cursor, scope, context.now);
  // Bounded scan permits Unicode normalization without a stale application-maintained index.
  // Empty pages can have a continuation; callers must follow next_cursor to finish searching.
  const rows = await readEntityRows(deps.db, context.principal.householdId, input.kinds, after, 201);
  const candidates: (ReturnType<typeof entitySummary> & { match_reason: MatchReason })[] = [];
  let last = after;
  let examined = 0;
  for (const row of rows.slice(0, 200)) {
    const reason = matchEntity(input.query, row.name, JSON.parse(row.aliases) as string[], row.related_name);
    last = row.key;
    examined++;
    if (reason) candidates.push({ ...entitySummary(row, context.version), match_reason: reason });
    if (candidates.length === input.limit) break;
  }
  const more = rows.length > examined;
  return { candidates, next_cursor: more ? await cursor.encode(scope, last, context.now) : null,
    search_complete: !more, data_origin: "user_authored" as const };
}

async function historyPage(deps: ReadDependencies, context: ReadContext, value: Record<string, unknown>) {
  const kind = kindInput(value.kind);
  const id = stringInput(value.id);
  const limit = limitInput(value.limit);
  await requiredEntity(deps, context, kind, id);
  const cursor = createReadCursor(deps.cursorSecret);
  const scope = cursorScope(context.principal, ["history", kind, id, limit, context.version.epoch, context.version.version]);
  const after = await cursor.decode(value.cursor, scope, context.now);
  const rows = await readHistoryRows(deps.db, context.principal.householdId, kind, id, after, limit + 1);
  const page = rows.slice(0, limit);
  return { records: page.map((row) => ({ id: row.id, kind: row.kind, occurrence_id: row.occurrence_id, occurred_at: row.occurred_at, occurred_on: row.occurred_on, date_precision: row.occurred_on === null ? "unknown" : "day", recorded_at: row.recorded_at, actor_user_id: row.actor_user_id, performer_user_id: row.performer_user_id, corrects_id: row.corrects_id, details: toWireValue(JSON.parse(row.data)) as Record<string, unknown>, client_id: row.client_id, time_zone: "Asia/Tokyo", data_origin: "user_authored" })),
    next_cursor: rows.length > limit ? await cursor.encode(scope, page[page.length - 1].key, context.now) : null };
}

export function createHouseholdReader(deps: ReadDependencies) {
  return {
    entitySearch(input: unknown) {
      return consistentRead(deps, (context) => searchPage(deps, context, searchInput(input)));
    },
    entityGet(input: unknown) {
      return consistentRead(deps, async (context) => {
        const value = objectInput(input, ["kind", "id"]);
        const row = await requiredEntity(deps, context, kindInput(value.kind), stringInput(value.id));
        const related = await readEntityRelations(deps.db, context.principal.householdId, row.kind, row.id);
        return { entity: { ...entityProjection(row, context.version, context.now), related } };
      });
    },
    historyList(input: unknown) {
      return consistentRead(deps, (context) => historyPage(deps, context, objectInput(input, ["kind", "id", "cursor", "limit"])));
    },
  };
}
