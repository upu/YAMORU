export const REMOTE_CLOUDFLARE_ENVIRONMENTS = ["preview", "production"] as const;

export type RemoteCloudflareEnvironment =
  (typeof REMOTE_CLOUDFLARE_ENVIRONMENTS)[number];

export type CloudflareTarget = {
  binding: "DB";
  databaseId: string;
  databaseName: string;
  environment: "local" | RemoteCloudflareEnvironment;
  workerName: string;
};

export type CloudflareTargets = {
  local: CloudflareTarget;
  preview: CloudflareTarget;
  production: CloudflareTarget;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}が設定されていません。`);
  }
  return value as UnknownRecord;
}

function readString(record: UnknownRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key}が設定されていません。`);
  }
  return value;
}

function readD1Binding(
  source: UnknownRecord,
  environment: CloudflareTarget["environment"],
  workerName: string,
): CloudflareTarget {
  const bindings = source.d1_databases;
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    throw new Error(`${environment}のD1 bindingは1件だけ指定してください。`);
  }
  const binding = asRecord(bindings[0], `${environment}.d1_databases[0]`);
  const bindingName = readString(binding, "binding", `${environment}.d1_databases[0]`);
  if (bindingName !== "DB") {
    throw new Error(`${environment}のD1 binding名はDBでなければなりません。`);
  }

  const databaseName = readString(
    binding,
    "database_name",
    `${environment}.d1_databases[0]`,
  );
  const expectedDatabaseName = `yamoru-${environment}`;
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `${environment}のD1名は${expectedDatabaseName}でなければなりません。`,
    );
  }

  return {
    binding: "DB",
    databaseId: readString(
      binding,
      "database_id",
      `${environment}.d1_databases[0]`,
    ),
    databaseName,
    environment,
    workerName,
  };
}

export function parseCloudflareTargets(config: unknown): CloudflareTargets {
  const root = asRecord(config, "wrangler.jsonc");
  const baseWorkerName = readString(root, "name", "wrangler.jsonc");
  if (baseWorkerName !== "yamoru") {
    throw new Error("Workerの基準名はyamoruでなければなりません。");
  }

  const environments = asRecord(root.env, "wrangler.jsonc.env");
  const preview = asRecord(environments.preview, "wrangler.jsonc.env.preview");
  const production = asRecord(
    environments.production,
    "wrangler.jsonc.env.production",
  );
  const targets = {
    local: readD1Binding(root, "local", baseWorkerName),
    preview: readD1Binding(
      preview,
      "preview",
      readString(preview, "name", "wrangler.jsonc.env.preview"),
    ),
    production: readD1Binding(
      production,
      "production",
      readString(production, "name", "wrangler.jsonc.env.production"),
    ),
  } satisfies CloudflareTargets;

  if (targets.preview.workerName !== "yamoru-preview") {
    throw new Error("preview Worker名はyamoru-previewでなければなりません。");
  }
  if (targets.production.workerName !== "yamoru-production") {
    throw new Error("production Worker名はyamoru-productionでなければなりません。");
  }
  if (targets.preview.databaseId === targets.production.databaseId) {
    throw new Error("previewとproductionは別のD1 database_idが必要です。");
  }
  return targets;
}

export function assertRemoteTargetReady(target: CloudflareTarget): void {
  if (target.environment === "local") {
    throw new Error("local D1をremote操作の対象にはできません。");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(target.databaseId)) {
    throw new Error(
      `${target.databaseName}のdatabase_idをCloudflareで作成したUUIDへ置き換えてください。`,
    );
  }
}

export function assertRemoteTargetConfirmation(
  environment: RemoteCloudflareEnvironment,
  confirmation: string,
): void {
  const expected = `yamoru-${environment}`;
  if (confirmation !== expected) {
    throw new Error(`対象確認には${expected}を完全一致で入力してください。`);
  }
}

export function getRemoteD1MigrationArgs(
  targets: CloudflareTargets,
  environment: RemoteCloudflareEnvironment,
): string[] {
  const target = targets[environment];
  return [
    "d1",
    "migrations",
    "apply",
    target.databaseName,
    "--remote",
    "--env",
    environment,
  ];
}
