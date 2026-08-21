import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRemoteTargetReady,
  assertRemoteTargetConfirmation,
  getRemoteD1MigrationArgs,
  parseCloudflareTargets,
} from "../scripts/cloudflare-target";

function readWranglerConfig(): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"));
}

function readAuthAdminWranglerConfig(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "wrangler.auth-admin.jsonc"), "utf8"),
  ) as Record<string, unknown>;
}

describe("Cloudflare環境分離", () => {
  it("local / preview / productionを別名・別D1として固定する", () => {
    const config = readWranglerConfig() as Record<string, unknown>;
    const targets = parseCloudflareTargets(config);

    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);

    expect(targets.local).toMatchObject({
      binding: "DB",
      databaseName: "yamoru-local",
      environment: "local",
    });
    expect(targets.preview).toMatchObject({
      binding: "DB",
      databaseName: "yamoru-preview",
      environment: "preview",
      workerName: "yamoru-preview",
    });
    expect(targets.production).toMatchObject({
      binding: "DB",
      databaseName: "yamoru-production",
      environment: "production",
      workerName: "yamoru-production",
    });
    expect(targets.preview.databaseId).not.toBe(targets.production.databaseId);
  });

  it.each(["preview", "production"] as const)(
    "%s migrationはremote DB名とWrangler環境を同時に指定する",
    (environment) => {
      const targets = parseCloudflareTargets(readWranglerConfig());

      expect(getRemoteD1MigrationArgs(targets, environment)).toEqual([
        "d1",
        "migrations",
        "apply",
        `yamoru-${environment}`,
        "--remote",
        "--env",
        environment,
      ]);
    },
  );

  it("production操作は対象DB名の完全一致を要求する", () => {
    expect(() => {
      assertRemoteTargetConfirmation("production", "yamoru-production");
    }).not.toThrow();
    expect(() => {
      assertRemoteTargetConfirmation("production", "production");
    }).toThrow(/yamoru-production/u);
    expect(() => {
      assertRemoteTargetConfirmation("preview", "yamoru-production");
    }).toThrow(/yamoru-preview/u);
  });

  it("remote D1作成前のplaceholderを操作対象として拒否する", () => {
    expect(() => {
      assertRemoteTargetReady({
        binding: "DB",
        databaseId: "production-d1-database-id-required",
        databaseName: "yamoru-production",
        environment: "production",
        workerName: "yamoru-production",
      });
    }).toThrow(/database_id/u);
  });

  it("remote操作は環境名入りの専用npm scriptからだけ実行する", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "auth:bootstrap:preview": "node scripts/auth-admin.ts bootstrap --environment preview",
      "auth:bootstrap:production":
        "node scripts/auth-admin.ts bootstrap --environment production",
      "cf:config:check": "node scripts/cloudflare.ts check",
      "cf:deploy:production": "node scripts/cloudflare.ts deploy production",
      "cf:smoke": "node scripts/cloudflare-smoke.ts",
      "d1:migrate:preview": "node scripts/cloudflare.ts migrate preview",
      "d1:migrate:production": "node scripts/cloudflare.ts migrate production",
      "data:migrate:dry-run":
        "node --env-file=scripts/d1-test.env scripts/data-migration.ts dry-run --environment production",
      "data:migrate:production":
        "node --env-file=scripts/d1-test.env scripts/data-migration.ts apply --environment production",
    });
  });

  it("一回限りのデータ移行はproduction D1だけをremote bindingにする", () => {
    const targets = parseCloudflareTargets(readWranglerConfig());
    const migrationConfig = JSON.parse(
      readFileSync(join(process.cwd(), "wrangler.data-migration.jsonc"), "utf8"),
    ) as { d1_databases: Array<Record<string, unknown>> };

    expect(migrationConfig.d1_databases).toEqual([{
      binding: "DB",
      database_id: targets.production.databaseId,
      database_name: "yamoru-production",
      remote: true,
    }]);
  });

  it("Auth管理専用設定はlocal / preview / productionのD1だけを分離して公開する", () => {
    const targets = parseCloudflareTargets(readWranglerConfig());
    const config = readAuthAdminWranglerConfig() as {
      main: string;
      d1_databases: Array<Record<string, unknown>>;
      env: Record<string, { d1_databases: Array<Record<string, unknown>> }>;
    };

    expect(config.main).toBe("scripts/auth-admin-platform.ts");
    expect(config.d1_databases).toEqual([{
      binding: "DB",
      database_id: "local-only-placeholder",
      database_name: "yamoru-local",
      migrations_dir: "d1/migrations",
      remote: false,
    }]);
    expect(config.env.preview.d1_databases).toEqual([{
      binding: "DB",
      database_id: targets.preview.databaseId,
      database_name: "yamoru-preview",
      remote: true,
    }]);
    expect(config.env.production.d1_databases).toEqual([{
      binding: "DB",
      database_id: targets.production.databaseId,
      database_name: "yamoru-production",
      remote: true,
    }]);
    expect(config).not.toHaveProperty("assets");
    expect(config).not.toHaveProperty("secrets");
    expect(config).not.toHaveProperty("services");
  });
});
