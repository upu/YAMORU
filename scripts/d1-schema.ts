import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type SchemaObjectType = "table" | "index" | "view" | "trigger";

type SchemaObject = {
  name: string;
  sql: string;
  type: SchemaObjectType;
};

type D1ExecuteResult = Array<{
  results?: unknown;
  success?: boolean;
}>;

export type D1SchemaOptions = {
  migrationsDirectory?: string;
  projectRoot: string;
  schemaPath?: string;
  temporaryDirectoryParent?: string;
};

const SCHEMA_QUERY = `
SELECT type, name, sql
FROM sqlite_schema
WHERE sql IS NOT NULL
  AND type IN ('table', 'index', 'view', 'trigger')
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND name <> 'd1_migrations'
ORDER BY
  CASE type
    WHEN 'table' THEN 1
    WHEN 'index' THEN 2
    WHEN 'view' THEN 3
    WHEN 'trigger' THEN 4
  END,
  name COLLATE BINARY;
`.trim();

const TYPE_ORDER: Record<SchemaObjectType, number> = {
  table: 1,
  index: 2,
  view: 3,
  trigger: 4,
};

function isSchemaObjectType(value: unknown): value is SchemaObjectType {
  return value === "table" || value === "index" || value === "view" || value === "trigger";
}

function schemaConfig(projectRoot: string, migrationsDirectory: string): string {
  const sourceConfig = readFileSync(
    join(projectRoot, "config", "wrangler", "d1-test.jsonc"),
    "utf8",
  );
  const compatibilityDate = /"compatibility_date"\s*:\s*"([^"]+)"/u
    .exec(sourceConfig)?.[1];
  if (compatibilityDate === undefined) {
    throw new Error("D1 test configにcompatibility_dateがありません。");
  }

  return `${JSON.stringify({
    compatibility_date: compatibilityDate,
    d1_databases: [{
      binding: "DB",
      database_id: "local-only-placeholder",
      database_name: "yamoru-schema-generator",
      migrations_dir: migrationsDirectory.replaceAll("\\", "/"),
    }],
    name: "yamoru-schema-generator",
  }, undefined, 2)}\n`;
}

function runWrangler(
  projectRoot: string,
  args: string[],
  operation: string,
): string {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"), ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        WRANGLER_WRITE_LOGS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${operation}に失敗しました。${detail === "" ? "" : `\n${detail}`}`);
  }
  return result.stdout;
}

function parseSchemaObjects(output: string): SchemaObject[] {
  const parsed = JSON.parse(output) as D1ExecuteResult;
  const results = parsed[0]?.results;
  if (!Array.isArray(results)) throw new Error("sqlite_schemaの取得結果が不正です。");

  const objects = results.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("sqlite_schemaに不正な行があります。");
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.name !== "string"
      || typeof row.sql !== "string"
      || !isSchemaObjectType(row.type)
    ) {
      throw new Error("sqlite_schemaに不正な行があります。");
    }
    return { name: row.name, sql: row.sql, type: row.type };
  });

  return objects.sort((left, right) => {
    const typeDifference = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
    if (typeDifference !== 0) return typeDifference;
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
}

function formatSchema(objects: SchemaObject[]): string {
  const body = objects.map(({ name, sql, type }) => {
    const statement = sql
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
      .replace(/;+$/u, "");
    return `-- ${type}: ${name}\n${statement};`;
  }).join("\n\n");

  return [
    "-- Generated file. Do not edit directly.",
    "-- Source of truth: d1/migrations/",
    "-- Regenerate: npm run d1:schema:generate",
    "",
    body,
    "",
  ].join("\n");
}

export function generateCurrentSchema(options: D1SchemaOptions): string {
  const projectRoot = resolve(options.projectRoot);
  const migrationsDirectory = resolve(
    options.migrationsDirectory ?? join(projectRoot, "d1", "migrations"),
  );
  const temporaryParent = resolve(options.temporaryDirectoryParent ?? tmpdir());
  const runDirectory = mkdtempSync(join(temporaryParent, "yamoru-d1-schema-"));

  try {
    const configPath = join(runDirectory, "wrangler.json");
    const persistPath = join(runDirectory, "state");
    writeFileSync(configPath, schemaConfig(projectRoot, migrationsDirectory));

    const commonArgs = ["--local", "--config", configPath, "--persist-to", persistPath];
    runWrangler(
      projectRoot,
      ["d1", "migrations", "apply", "DB", ...commonArgs],
      "migration適用",
    );
    const output = runWrangler(
      projectRoot,
      ["d1", "execute", "DB", ...commonArgs, "--command", SCHEMA_QUERY, "--json"],
      "sqlite_schema取得",
    );
    return formatSchema(parseSchemaObjects(output));
  } finally {
    rmSync(runDirectory, { force: true, recursive: true });
  }
}

function resolvedSchemaPath(options: D1SchemaOptions): string {
  return resolve(options.schemaPath ?? join(options.projectRoot, "d1", "schema.generated.sql"));
}

export function writeCurrentSchema(options: D1SchemaOptions): void {
  const schemaPath = resolvedSchemaPath(options);
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, generateCurrentSchema(options));
}

export function checkCurrentSchema(options: D1SchemaOptions): void {
  const schemaPath = resolvedSchemaPath(options);
  if (!existsSync(schemaPath)) {
    throw new Error("生成済みschemaがありません。npm run d1:schema:generateを実行してください。");
  }
  const committed = readFileSync(schemaPath, "utf8");
  assertCurrentSchema(committed, generateCurrentSchema(options));
}

export function assertCurrentSchema(committed: string, generated: string): void {
  if (committed !== generated) {
    throw new Error("生成済みschemaに差分があります。npm run d1:schema:generateを実行してください。");
  }
}

function main(args: string[]): void {
  const command = args[0];
  const options = { projectRoot: process.cwd() };
  if (args.length !== 1 || (command !== "generate" && command !== "check")) {
    throw new Error("Usage: d1-schema <generate|check>");
  }
  if (command === "generate") {
    writeCurrentSchema(options);
    process.stdout.write("d1/schema.generated.sqlを再生成しました。\n");
    return;
  }
  checkCurrentSchema(options);
  process.stdout.write("d1/schema.generated.sqlが最新です。\n");
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "D1 schema操作に失敗しました。";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
