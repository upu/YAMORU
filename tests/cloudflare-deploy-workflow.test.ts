import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Cloudflare production deploy workflow", () => {
  it("mainのQuality checksが成功した同一commitだけを本番へ反映する", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/deploy-production.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["Quality checks"]');
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");

    const orderedCommands = [
      "npm run cf:config:check",
      "npm run d1:migrate:production",
      "npm run cf:build",
      "npm run cf:deploy:production",
      "npm run cf:smoke",
    ];
    let previous = -1;
    for (const command of orderedCommands) {
      const next = workflow.indexOf(command);
      expect(next, `${command}がworkflowにありません`).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it("Cloudflare認証情報と公開URLをリポジトリへ直書きしない", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/deploy-production.yml"),
      "utf8",
    );

    expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("vars.YAMORU_PRODUCTION_URL");
    expect(workflow).not.toMatch(/AUTH_SECRET\s*:/u);
  });
});
