import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function readWorkflow(fileName: string): string {
  return readFileSync(
    join(process.cwd(), ".github/workflows", fileName),
    "utf8",
  );
}

function expectOrderedCommands(workflow: string, commands: string[]): void {
  let previous = -1;
  for (const command of commands) {
    const next = workflow.indexOf(command);
    expect(next, `${command}がworkflowにありません`).toBeGreaterThan(previous);
    previous = next;
  }
}

describe("Cloudflare preview deploy workflow", () => {
  it("mainのQuality checksが成功した同一commitだけをpreviewへ反映する", () => {
    const workflow = readWorkflow("deploy-preview.yml");

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["Quality checks"]');
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(workflow).toContain("name: preview");
    expect(workflow).toContain("vars.YAMORU_PREVIEW_URL");

    expectOrderedCommands(workflow, [
      "npm run cf:config:check",
      "npm run d1:migrate:preview",
      "npm run cf:build",
      "npm run cf:deploy:preview",
      "npm run cf:smoke",
    ]);
  });
});

describe("Cloudflare production deploy workflow", () => {
  it("stable Releaseのtag commitを再検証してから本番へ反映する", () => {
    const workflow = readWorkflow("deploy-production.yml");

    expect(workflow).toContain("release:");
    expect(workflow).toContain("types: [published]");
    expect(workflow).not.toContain("workflow_run:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("github.event.release.draft == false");
    expect(workflow).toContain("github.event.release.prerelease == false");
    expect(workflow).toContain("uses: ./.github/workflows/ci.yml");
    expect(workflow).toContain("needs: quality");
    expect(workflow).toContain("ref: ${{ github.event.release.tag_name }}");
    expect(workflow).toContain("RELEASE_TAG: ${{ github.event.release.tag_name }}");
    expect(workflow).toContain("node scripts/release-target.ts");
    expect(workflow).toContain("name: production");

    expectOrderedCommands(workflow, [
      "node scripts/release-target.ts",
      "npm run cf:config:check",
      "npm run d1:migrate:production",
      "npm run cf:build",
      "npm run cf:deploy:production",
      "npm run cf:smoke",
    ]);
  });

  it("Quality checksをRelease commitへ再利用できる", () => {
    expect(readWorkflow("ci.yml")).toContain("workflow_call:");
  });

  it("Cloudflare認証情報と公開URLをEnvironmentから受け取る", () => {
    for (const [fileName, urlVariable] of [
      ["deploy-preview.yml", "vars.YAMORU_PREVIEW_URL"],
      ["deploy-production.yml", "vars.YAMORU_PRODUCTION_URL"],
    ]) {
      const workflow = readWorkflow(fileName);
      expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
      expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
      expect(workflow).toContain(urlVariable);
      expect(workflow).not.toMatch(/AUTH_SECRET\s*:/u);
    }
  });
});
