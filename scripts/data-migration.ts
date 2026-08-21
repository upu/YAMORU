import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { getPlatformProxy } from "wrangler";

import {
  assertMigrationTargetSchema,
  buildMigrationPlan,
  MIGRATED_DATA_TABLES,
  parseDataMigrationInvocation,
  REQUIRED_MIGRATION_COLUMNS,
  summarizeMigrationPlan,
  type MigrationPlan,
  type SourceDataDump,
  type TargetSnapshot,
} from "./data-migration-contract.ts";
import { assertRemoteTargetConfirmation } from "./cloudflare-target.ts";
import { envWorkdir, readProjectId } from "./supabase-cli.ts";

const SOURCE_PROJECT_ID = "YAMORU-prod-local";
const SOURCE_CONTAINER = `supabase_db_${SOURCE_PROJECT_ID}`;

const SOURCE_QUERIES: Record<keyof SourceDataDump, string> = {
  users: `SELECT id::text, email, created_at FROM auth.users ORDER BY created_at, id`,
  households: `SELECT id::text, name, created_at FROM public.households ORDER BY created_at, id`,
  household_members: `SELECT id::text, household_id::text, user_id::text, created_at
    FROM public.household_members ORDER BY created_at, id`,
  profiles: `SELECT user_id::text, nickname, created_at FROM public.profiles ORDER BY created_at, user_id`,
  managed_items: `SELECT id::text, household_id::text, name, kind, created_at
    FROM public.managed_items ORDER BY created_at, id`,
  external_links: `SELECT id::text, household_id::text, managed_item_id::text, url, created_at
    FROM public.external_links ORDER BY created_at, id`,
  task_rules: `SELECT id::text, household_id::text, managed_item_id::text, title,
      recurrence_basis, deadline_kind, unresolved_policy, recommended_start_offset,
      recommended_until_offset, schedule_kind, schedule_day_of_week,
      schedule_day_of_month, schedule_week_of_month, schedule_month, created_at
    FROM public.task_rules ORDER BY created_at, id`,
  task_occurrences: `SELECT id::text, household_id::text, task_rule_id::text, scheduled_for,
      due_at, assignee_user_id::text, status, created_at
    FROM public.task_occurrences ORDER BY created_at, id`,
  activity_logs: `SELECT id::text, household_id::text, task_occurrence_id::text, action,
      actor_user_id::text, performed_by_user_id::text, occurred_at, recorded_at,
      idempotency_key, next_task_occurrence_id::text, previous_due_at, new_due_at,
      previous_assignee_user_id::text, new_assignee_user_id::text
    FROM public.activity_logs ORDER BY recorded_at, id`,
  household_invitations: `SELECT id::text, household_id::text, invited_email,
      encode(token_hash, 'hex') AS token_hash, created_by::text, created_at, expires_at,
      cancelled_at, accepted_at, accepted_by::text, replaced_by::text
    FROM public.household_invitations ORDER BY created_at, id`,
  invitation_claims: `SELECT id::text, invitation_id::text,
      encode(claim_secret_hash, 'hex') AS claim_secret_hash, created_at, expires_at
    FROM public.invitation_pending_claims
    WHERE invitation_id IS NOT NULL AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at, id`,
};

function querySource<T>(query: string): T[] {
  const jsonQuery = `SELECT COALESCE(json_agg(row_to_json(source_rows)), '[]'::json)::text
    FROM (${query}) AS source_rows`;
  const output = execFileSync(
    "docker",
    [
      "exec",
      SOURCE_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      jsonQuery,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim()) as T[];
}

function readSourceData(): SourceDataDump {
  const workdir = envWorkdir("prod");
  if (readProjectId(workdir) !== SOURCE_PROJECT_ID) {
    throw new Error(`移行元は${SOURCE_PROJECT_ID}でなければなりません。`);
  }
  return Object.fromEntries(
    Object.entries(SOURCE_QUERIES).map(([table, query]) => [table, querySource(query)]),
  ) as SourceDataDump;
}

async function readTargetSnapshot(db: D1Database): Promise<TargetSnapshot> {
  const users = await db.prepare(
    `SELECT id, email, password_hash IS NOT NULL AS password_hash_present, created_at
       FROM users ORDER BY created_at, id`,
  ).all<TargetSnapshot["users"][number]>();
  const counts = {} as TargetSnapshot["counts"];
  for (const table of MIGRATED_DATA_TABLES) {
    const row = await db.prepare(`SELECT count(*) AS count FROM ${table}`)
      .first<{ count: number }>();
    counts[table] = row?.count ?? 0;
  }
  return { users: users.results, counts };
}

async function verifyTargetSchema(db: D1Database): Promise<void> {
  const columnsByTable = {} as Record<keyof typeof REQUIRED_MIGRATION_COLUMNS, string[]>;
  for (const table of Object.keys(REQUIRED_MIGRATION_COLUMNS) as Array<
    keyof typeof REQUIRED_MIGRATION_COLUMNS
  >) {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    columnsByTable[table] = result.results.map((column) => column.name);
  }
  assertMigrationTargetSchema(columnsByTable);
}

type Row = Record<string, unknown>;

function insertStatements(
  db: D1Database,
  table: string,
  rows: Row[],
): D1PreparedStatement[] {
  return rows.map((row) => {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `?${String(index + 1)}`);
    return db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    ).bind(...columns.map((column) => row[column]));
  });
}

function planStatements(db: D1Database, plan: MigrationPlan): D1PreparedStatement[] {
  const tables: Array<[string, Row[]]> = [
    ["users", plan.users],
    ["households", plan.households],
    ["household_members", plan.household_members],
    ["profiles", plan.profiles],
    ["managed_items", plan.managed_items],
    ["external_links", plan.external_links],
    ["task_rules", plan.task_rules],
    ["task_occurrences", plan.task_occurrences],
    ["activity_logs", plan.activity_logs],
    ["household_invitations", plan.household_invitations],
    ["invitation_claims", plan.invitation_claims],
  ];
  return tables.flatMap(([table, rows]) => insertStatements(db, table, rows));
}

async function assertApplied(db: D1Database, plan: MigrationPlan): Promise<void> {
  const snapshot = await readTargetSnapshot(db);
  const expected = summarizeMigrationPlan(plan);
  const expectedCounts: TargetSnapshot["counts"] = {
    households: expected.households,
    household_members: expected.householdMembers,
    profiles: expected.profiles,
    managed_items: expected.managedItems,
    external_links: expected.externalLinks,
    task_rules: expected.taskRules,
    task_occurrences: expected.taskOccurrences,
    activity_logs: expected.activityLogs,
    household_invitations: expected.householdInvitations,
    invitation_claims: expected.invitationClaims,
  };
  for (const table of MIGRATED_DATA_TABLES) {
    if (snapshot.counts[table] !== expectedCounts[table]) {
      throw new Error(`${table}の移行後件数が一致しません。`);
    }
  }
  const foreignKeyFailures = await db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.results.length !== 0) {
    throw new Error("production D1の参照整合性チェックに失敗しました。 なにも削除しないでください。");
  }
}

async function readConfirmation(): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await prompt.question(
      "移行先の確認として yamoru-production を入力: ",
    );
    assertRemoteTargetConfirmation("production", value);
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const invocation = parseDataMigrationInvocation(process.argv.slice(2));
  await readConfirmation();
  const platform = await getPlatformProxy<CloudflareEnv>({
    configPath: "wrangler.data-migration.jsonc",
    persist: false,
    remoteBindings: true,
  });
  try {
    await verifyTargetSchema(platform.env.DB);
    const source = readSourceData();
    const target = await readTargetSnapshot(platform.env.DB);
    const plan = buildMigrationPlan(source, target);
    const summary = summarizeMigrationPlan(plan);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (invocation.command === "dry-run") {
      process.stdout.write("dry run完了: production D1は変更していません。\n");
      return;
    }
    const statements = planStatements(platform.env.DB, plan);
    if (statements.length !== 0) await platform.env.DB.batch(statements);
    await assertApplied(platform.env.DB, plan);
    process.stdout.write(
      "production D1への移行と、件数・参照整合性の確認が完了しました。\n",
    );
  } finally {
    await platform.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : "不明なエラー";
    process.stderr.write(`データ移行を完了できませんでした: ${message}\n`);
    process.exitCode = 1;
  }
}
