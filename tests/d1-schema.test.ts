import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertCurrentSchema,
  checkCurrentSchema,
  generateCurrentSchema,
} from "../scripts/d1-schema";

const PROJECT_ROOT = process.cwd();
const WRANGLER_TEST_TIMEOUT_MS = 120_000;
const testRoot = mkdtempSync(join(tmpdir(), "yamoru-d1-schema-test-"));

afterAll(() => {
  rmSync(testRoot, { force: true, recursive: true });
});

function temporaryParent(name: string): string {
  const path = join(testRoot, name);
  mkdirSync(path);
  return path;
}

describe("D1 schema生成", () => {
  it("空の専用local D1から同じschemaを決定的に生成する", () => {
    const temporaryDirectoryParent = temporaryParent("deterministic");

    const first = generateCurrentSchema({
      projectRoot: PROJECT_ROOT,
      temporaryDirectoryParent,
    });
    const second = generateCurrentSchema({
      projectRoot: PROJECT_ROOT,
      temporaryDirectoryParent,
    });

    expect(second).toBe(first);
    expect(first).toContain("Generated file. Do not edit directly.");
    expect(first).toContain("Source of truth: d1/migrations/");
    expect(first).toMatch(/CREATE TABLE "?task_rules"?/u);
    expect(first).toContain("FOREIGN KEY");
    expect(first).toContain("UNIQUE");
    expect(first).toContain("CHECK");
    expect(first).toContain("CREATE INDEX task_rules_household_id_idx");
    expect(first).toContain("CREATE TRIGGER task_occurrences_undated_once_or_manual_insert");
    expect(first).not.toContain("d1_migrations");
    expect(first).not.toContain("sqlite_sequence");
    expect(readdirSync(temporaryDirectoryParent)).toEqual([]);
  }, WRANGLER_TEST_TIMEOUT_MS);

  it("ディレクトリへ追加した一時migrationも列挙してschemaへ含める", () => {
    const migrationsDirectory = join(testRoot, "migrations-with-probe");
    cpSync(join(PROJECT_ROOT, "d1", "migrations"), migrationsDirectory, {
      recursive: true,
    });
    writeFileSync(
      join(migrationsDirectory, "9999_schema_generation_probe.sql"),
      [
        "CREATE TABLE schema_generation_probe (id TEXT PRIMARY KEY);",
        "CREATE TABLE acf_x (id TEXT PRIMARY KEY);",
        "",
      ].join("\n"),
    );

    const schema = generateCurrentSchema({
      migrationsDirectory,
      projectRoot: PROJECT_ROOT,
      temporaryDirectoryParent: temporaryParent("migration-probe"),
    });

    expect(schema).toContain("CREATE TABLE schema_generation_probe");
    expect(schema).toContain("CREATE TABLE acf_x");
  }, WRANGLER_TEST_TIMEOUT_MS);

  it("checkは一致時だけ成功し、差分時も追跡対象を書き換えない", () => {
    const schemaPath = join(testRoot, "schema.generated.sql");
    const options = {
      projectRoot: PROJECT_ROOT,
      schemaPath,
      temporaryDirectoryParent: temporaryParent("check"),
    };

    const committed = generateCurrentSchema(options);
    writeFileSync(schemaPath, committed);
    expect(() => {
      checkCurrentSchema(options);
    }).not.toThrow();

    writeFileSync(schemaPath, `${committed}-- stale\n`);
    expect(() => {
      assertCurrentSchema(`${committed}-- stale\n`, committed);
    }).toThrow(/d1:schema:generate/u);
    expect(readFileSync(schemaPath, "utf8")).toBe(`${committed}-- stale\n`);
  }, WRANGLER_TEST_TIMEOUT_MS);

  it("migration適用失敗でも専用一時領域を後片付けする", () => {
    const migrationsDirectory = join(testRoot, "broken-migrations");
    mkdirSync(migrationsDirectory);
    writeFileSync(join(migrationsDirectory, "0001_broken.sql"), "INVALID SQL;\n");
    const temporaryDirectoryParent = temporaryParent("failure-cleanup");

    expect(() => generateCurrentSchema({
      migrationsDirectory,
      projectRoot: PROJECT_ROOT,
      temporaryDirectoryParent,
    })).toThrow(/migration/u);
    expect(readdirSync(temporaryDirectoryParent)).toEqual([]);
  }, WRANGLER_TEST_TIMEOUT_MS);

  it("npm scriptsとCIがschema生成物の差分検査を実行する", () => {
    const packageJson = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const workflow = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(packageJson.scripts["d1:schema:generate"]).toBe(
      "node --env-file=scripts/d1-test.env scripts/d1-schema.ts generate",
    );
    expect(packageJson.scripts["d1:schema:check"]).toBe(
      "node --env-file=scripts/d1-test.env scripts/d1-schema.ts check",
    );
    expect(workflow).toContain("run: npm run d1:schema:check");
  });
});
