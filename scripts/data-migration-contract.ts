export type SourceUser = {
  id: string;
  email: string;
  created_at: string;
};

type Household = { id: string; name: string; created_at: string };
type HouseholdMember = {
  id: string;
  household_id: string;
  user_id: string;
  created_at: string;
};
type Profile = { user_id: string; nickname: string; created_at: string };
type ManagedItem = {
  id: string;
  household_id: string;
  name: string;
  kind: string;
  created_at: string;
};
type ExternalLink = {
  id: string;
  household_id: string;
  managed_item_id: string;
  url: string;
  created_at: string;
};
type TaskRule = {
  id: string;
  household_id: string;
  managed_item_id: string | null;
  title: string;
  recurrence_basis: string;
  deadline_kind: string;
  unresolved_policy: string;
  recommended_start_offset: number;
  recommended_until_offset: number;
  schedule_kind: string | null;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  schedule_week_of_month: number | null;
  schedule_month: number | null;
  created_at: string;
};
type TaskOccurrence = {
  id: string;
  household_id: string;
  task_rule_id: string;
  scheduled_for: string;
  due_at: string;
  assignee_user_id: string | null;
  status: string;
  created_at: string;
};
type ActivityLog = {
  id: string;
  household_id: string;
  task_occurrence_id: string;
  action: string;
  actor_user_id: string;
  performed_by_user_id: string | null;
  occurred_at: string;
  recorded_at: string;
  idempotency_key: string | null;
  next_task_occurrence_id: string | null;
  previous_due_at: string | null;
  new_due_at: string | null;
  previous_assignee_user_id: string | null;
  new_assignee_user_id: string | null;
};
type HouseholdInvitation = {
  id: string;
  household_id: string;
  invited_email: string;
  token_hash: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  cancelled_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  replaced_by: string | null;
};
type InvitationClaim = {
  id: string;
  invitation_id: string;
  claim_secret_hash: string;
  created_at: string;
  expires_at: string;
};

export type SourceDataDump = {
  users: SourceUser[];
  households: Household[];
  household_members: HouseholdMember[];
  profiles: Profile[];
  managed_items: ManagedItem[];
  external_links: ExternalLink[];
  task_rules: TaskRule[];
  task_occurrences: TaskOccurrence[];
  activity_logs: ActivityLog[];
  household_invitations: HouseholdInvitation[];
  invitation_claims: InvitationClaim[];
};

export const MIGRATED_DATA_TABLES = [
  "households",
  "household_members",
  "profiles",
  "managed_items",
  "external_links",
  "task_rules",
  "task_occurrences",
  "activity_logs",
  "household_invitations",
  "invitation_claims",
] as const;

export const REQUIRED_MIGRATION_COLUMNS = {
  household_members: ["source_id"],
  activity_logs: [
    "previous_due_at",
    "new_due_at",
    "previous_assignee_user_id",
    "new_assignee_user_id",
  ],
  household_invitations: ["replaced_by_invitation_id"],
} as const;

type MigratedDataTable = (typeof MIGRATED_DATA_TABLES)[number];

export type TargetSnapshot = {
  users: Array<{
    id: string;
    email: string;
    password_hash_present: boolean;
    created_at: string;
  }>;
  counts: Record<MigratedDataTable, number>;
};

type TargetUser = {
  id: string;
  email: string;
  password_hash: null;
  session_version: 0;
  created_at: string;
};

export type MigrationPlan = Omit<
  SourceDataDump,
  "users" | "household_members" | "household_invitations"
> & {
  users: TargetUser[];
  household_members: Array<Omit<HouseholdMember, "id"> & { source_id: string }>;
  household_invitations: Array<
    Omit<HouseholdInvitation, "accepted_by" | "created_by" | "replaced_by"> & {
      accepted_by_user_id: string | null;
      created_by_user_id: string;
      replaced_at: string | null;
      replaced_by_invitation_id: string | null;
      status: "accepted" | "cancelled" | "pending" | "replaced";
    }
  >;
  userIdMap: Map<string, string>;
  matchedUsers: number;
};

export type DataMigrationInvocation = {
  command: "dry-run" | "apply";
  environment: "production";
};

export function parseDataMigrationInvocation(args: string[]): DataMigrationInvocation {
  const [command, environmentFlag, environment, ...rest] = args;
  if (
    (command !== "dry-run" && command !== "apply") ||
    environmentFlag !== "--environment" ||
    environment !== "production" ||
    rest.length !== 0
  ) {
    throw new Error(
      "dry-runまたはapplyと、--environment productionを明示してください。",
    );
  }
  return { command, environment };
}

export function assertMigrationTargetSchema(
  columnsByTable: Record<keyof typeof REQUIRED_MIGRATION_COLUMNS, string[]>,
): void {
  for (const [table, requiredColumns] of Object.entries(REQUIRED_MIGRATION_COLUMNS)) {
    const actualColumns = new Set(columnsByTable[table as keyof typeof REQUIRED_MIGRATION_COLUMNS]);
    const missing = requiredColumns.filter((column) => !actualColumns.has(column));
    if (missing.length !== 0) {
      throw new Error(`production D1へ0003 migrationが適用されていません: ${table}`);
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const TIMESTAMP_FIELDS = new Set([
  "created_at",
  "updated_at",
  "scheduled_for",
  "due_at",
  "occurred_at",
  "recorded_at",
  "previous_due_at",
  "new_due_at",
  "expires_at",
  "cancelled_at",
  "accepted_at",
  "replaced_at",
]);

function normalizeTimestamp(value: string): string {
  const normalized = value.replace(/\+00(?::00)?$/u, "Z");
  if (!normalized.endsWith("Z") || Number.isNaN(Date.parse(normalized))) {
    throw new Error("移行元の日時はUTCでなければなりません。");
  }
  return normalized;
}

function normalizeTimestampFields(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([field, value]) => [
    field,
    TIMESTAMP_FIELDS.has(field) && typeof value === "string"
      ? normalizeTimestamp(value)
      : value,
  ]));
}

function normalizeSourceTimestamps(source: SourceDataDump): SourceDataDump {
  return Object.fromEntries(Object.entries(source).map(([table, rows]) => [
    table,
    rows.map((row) => normalizeTimestampFields(row)),
  ])) as SourceDataDump;
}

function assertTargetIsEmpty(target: TargetSnapshot): void {
  const populated = MIGRATED_DATA_TABLES.filter((table) => target.counts[table] !== 0);
  if (populated.length !== 0) {
    throw new Error(
      `移行先はusers以外が空である必要があります: ${populated.join(", ")}`,
    );
  }
}

function uniqueIds(rows: Array<{ id: string }>, table: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${table}に重複IDがあります。`);
    ids.add(row.id);
  }
  return ids;
}

function requireReference(
  ids: Set<string>,
  value: string | null,
  table: string,
  reference: string,
): void {
  if (value !== null && !ids.has(value)) {
    throw new Error(`${table}の${reference}参照が壊れています。`);
  }
}

function buildUserMapping(source: SourceDataDump, target: TargetSnapshot): {
  importedUsers: TargetUser[];
  matchedUsers: number;
  userIdMap: Map<string, string>;
} {
  const targetByEmail = new Map(target.users.map((user) => [normalizeEmail(user.email), user]));
  const targetById = new Map(target.users.map((user) => [user.id, user]));
  const sourceEmails = new Set<string>();
  const userIdMap = new Map<string, string>();
  const importedUsers: TargetUser[] = [];
  let matchedUsers = 0;

  for (const user of source.users) {
    const email = normalizeEmail(user.email);
    if (sourceEmails.has(email)) throw new Error("移行元usersに重複emailがあります。");
    sourceEmails.add(email);
    const existing = targetByEmail.get(email);
    if (existing !== undefined) {
      userIdMap.set(user.id, existing.id);
      matchedUsers += 1;
      continue;
    }
    const idCollision = targetById.get(user.id);
    if (idCollision !== undefined) {
      throw new Error("移行元user IDが別のAuth.js利用者と衝突しています。");
    }
    userIdMap.set(user.id, user.id);
    importedUsers.push({
      id: user.id,
      email,
      password_hash: null,
      session_version: 0,
      created_at: user.created_at,
    });
  }

  const sourceEmailSet = new Set(source.users.map((user) => normalizeEmail(user.email)));
  if (target.users.some((user) => !sourceEmailSet.has(normalizeEmail(user.email)))) {
    throw new Error("移行元に存在しないAuth.js利用者がproduction D1に存在します。");
  }
  return { importedUsers, matchedUsers, userIdMap };
}

function remapUser(
  userIdMap: Map<string, string>,
  value: string,
  label: string,
): string;
function remapUser(
  userIdMap: Map<string, string>,
  value: string | null,
  label: string,
): string | null;
function remapUser(userIdMap: Map<string, string>, value: string | null, label: string) {
  if (value === null) return null;
  const mapped = userIdMap.get(value);
  if (mapped === undefined) throw new Error(`${label}が移行元usersを参照していません。`);
  return mapped;
}

function validateRelations(source: SourceDataDump): void {
  const householdIds = uniqueIds(source.households, "households");
  const itemIds = uniqueIds(source.managed_items, "managed_items");
  const ruleIds = uniqueIds(source.task_rules, "task_rules");
  const occurrenceIds = uniqueIds(source.task_occurrences, "task_occurrences");
  const invitationIds = uniqueIds(source.household_invitations, "household_invitations");
  uniqueIds(source.external_links, "external_links");
  uniqueIds(source.activity_logs, "activity_logs");
  uniqueIds(source.invitation_claims, "invitation_claims");

  for (const row of source.household_members) {
    requireReference(householdIds, row.household_id, "household_members", "household_id");
  }
  for (const row of source.managed_items) {
    requireReference(householdIds, row.household_id, "managed_items", "household_id");
  }
  for (const row of source.external_links) {
    requireReference(householdIds, row.household_id, "external_links", "household_id");
    requireReference(itemIds, row.managed_item_id, "external_links", "managed_item_id");
  }
  for (const row of source.task_rules) {
    requireReference(householdIds, row.household_id, "task_rules", "household_id");
    requireReference(itemIds, row.managed_item_id, "task_rules", "managed_item_id");
  }
  for (const row of source.task_occurrences) {
    requireReference(householdIds, row.household_id, "task_occurrences", "household_id");
    requireReference(ruleIds, row.task_rule_id, "task_occurrences", "task_rule_id");
  }
  for (const row of source.activity_logs) {
    requireReference(householdIds, row.household_id, "activity_logs", "household_id");
    requireReference(occurrenceIds, row.task_occurrence_id, "activity_logs", "task_occurrence_id");
    requireReference(occurrenceIds, row.next_task_occurrence_id, "activity_logs", "next_task_occurrence_id");
  }
  for (const row of source.household_invitations) {
    requireReference(householdIds, row.household_id, "household_invitations", "household_id");
    requireReference(invitationIds, row.replaced_by, "household_invitations", "replaced_by");
  }
  for (const row of source.invitation_claims) {
    requireReference(invitationIds, row.invitation_id, "invitation_claims", "invitation_id");
  }
}

function invitationStatus(invitation: HouseholdInvitation): "accepted" | "cancelled" | "pending" | "replaced" {
  if (invitation.accepted_at !== null) return "accepted";
  if (invitation.cancelled_at !== null) return "cancelled";
  if (invitation.replaced_by !== null) return "replaced";
  return "pending";
}

function remapHouseholdMembers(source: SourceDataDump, userIdMap: Map<string, string>) {
  return source.household_members.map(({ id, ...row }) => ({
    ...row,
    source_id: id,
    user_id: remapUser(userIdMap, row.user_id, "household_members.user_id"),
  }));
}

function remapProfiles(source: SourceDataDump, userIdMap: Map<string, string>) {
  return source.profiles.map((row) => ({
    ...row,
    user_id: remapUser(userIdMap, row.user_id, "profiles.user_id"),
    updated_at: row.created_at,
  }));
}

function remapOccurrences(source: SourceDataDump, userIdMap: Map<string, string>) {
  return source.task_occurrences.map((row) => ({
    ...row,
    assignee_user_id: remapUser(
      userIdMap,
      row.assignee_user_id,
      "task_occurrences.assignee_user_id",
    ),
  }));
}

function remapActivityLogs(source: SourceDataDump, userIdMap: Map<string, string>) {
  return source.activity_logs.map((row) => ({
    ...row,
    actor_user_id: remapUser(userIdMap, row.actor_user_id, "activity_logs.actor_user_id"),
    performed_by_user_id: remapUser(
      userIdMap,
      row.performed_by_user_id,
      "activity_logs.performed_by_user_id",
    ),
    assignee_user_id: remapUser(
      userIdMap,
      row.new_assignee_user_id,
      "activity_logs.new_assignee_user_id",
    ),
    previous_assignee_user_id: remapUser(
      userIdMap,
      row.previous_assignee_user_id,
      "activity_logs.previous_assignee_user_id",
    ),
    new_assignee_user_id: remapUser(
      userIdMap,
      row.new_assignee_user_id,
      "activity_logs.new_assignee_user_id",
    ),
  }));
}

function remapInvitations(source: SourceDataDump, userIdMap: Map<string, string>) {
  const invitationById = new Map(source.household_invitations.map((row) => [row.id, row]));
  return source.household_invitations.map((row) => ({
    id: row.id,
    household_id: row.household_id,
    invited_email: normalizeEmail(row.invited_email),
    token_hash: row.token_hash,
    status: invitationStatus(row),
    created_by_user_id: remapUser(userIdMap, row.created_by, "household_invitations.created_by"),
    created_at: row.created_at,
    expires_at: row.expires_at,
    cancelled_at: row.cancelled_at,
    accepted_at: row.accepted_at,
    accepted_by_user_id: remapUser(
      userIdMap,
      row.accepted_by,
      "household_invitations.accepted_by",
    ),
    replaced_at: row.replaced_by === null
      ? null
      : invitationById.get(row.replaced_by)?.created_at ?? null,
    replaced_by_invitation_id: row.replaced_by,
  }));
}

export function buildMigrationPlan(
  source: SourceDataDump,
  target: TargetSnapshot,
): MigrationPlan {
  assertTargetIsEmpty(target);
  const normalizedSource = normalizeSourceTimestamps(source);
  validateRelations(normalizedSource);
  const { importedUsers, matchedUsers, userIdMap } = buildUserMapping(normalizedSource, target);

  return {
    users: importedUsers,
    userIdMap,
    matchedUsers,
    households: normalizedSource.households,
    household_members: remapHouseholdMembers(normalizedSource, userIdMap),
    profiles: remapProfiles(normalizedSource, userIdMap),
    managed_items: normalizedSource.managed_items,
    external_links: normalizedSource.external_links,
    task_rules: normalizedSource.task_rules,
    task_occurrences: remapOccurrences(normalizedSource, userIdMap),
    activity_logs: remapActivityLogs(normalizedSource, userIdMap),
    household_invitations: remapInvitations(normalizedSource, userIdMap),
    invitation_claims: normalizedSource.invitation_claims,
  };
}

export function summarizeMigrationPlan(plan: MigrationPlan) {
  return {
    sourceUsers: plan.userIdMap.size,
    matchedUsers: plan.matchedUsers,
    importedUsersWithoutPassword: plan.users.length,
    households: plan.households.length,
    householdMembers: plan.household_members.length,
    profiles: plan.profiles.length,
    managedItems: plan.managed_items.length,
    externalLinks: plan.external_links.length,
    taskRules: plan.task_rules.length,
    taskOccurrences: plan.task_occurrences.length,
    activityLogs: plan.activity_logs.length,
    householdInvitations: plan.household_invitations.length,
    invitationClaims: plan.invitation_claims.length,
  };
}
