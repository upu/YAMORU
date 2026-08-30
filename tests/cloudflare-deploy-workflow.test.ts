import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// workflowのYAMLをそのまま写した照合は、挙動を変えていない構成変更でも失敗して
// 変更を妨げる(#278)。ここでは「検証済みのcommitだけを配備する」「環境を取り違え
// ない」「Secretを露出しない」という、壊れると実害が出る不変条件だけを確認する。

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

// #274でLint・Typecheck・Test・Buildを並列jobへ分割した。jobを組み替えても
// 検査が黙って抜け落ちないことと、jobどうしが直列化していないことを確認する。
describe("Quality checks workflow(#274)", () => {
  it("Lint・Typecheck・Test・BuildとD1テストをすべて実行する", () => {
    const workflow = readWorkflow("ci.yml");

    for (const command of [
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm run d1:migrate",
      "npm run test:d1",
    ]) {
      expect(workflow, `${command}がworkflowにありません`).toContain(command);
    }
  });

  it("jobどうしを直列化せず、並列に実行する", () => {
    expect(readWorkflow("ci.yml")).not.toContain("needs:");
  });

  it("production Releaseから同じ検査を再利用できる", () => {
    expect(readWorkflow("ci.yml")).toContain("workflow_call:");
  });
});

describe("Cloudflare preview deploy workflow", () => {
  it("mainのQuality checksが成功した、その同一commitだけをpreviewへ反映する", () => {
    const workflow = readWorkflow("deploy-preview.yml");

    expect(workflow).toContain('workflows: ["Quality checks"]');
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    // 検査した時点のcommitをそのままcheckoutする。ここがブランチ名などに
    // 変わると、未検査のcommitが配備されうる。
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
  });

  it("preview環境を指定し、公開境界の確認まで順に実行する", () => {
    const workflow = readWorkflow("deploy-preview.yml");

    expect(workflow).toContain("YAMORU_APP_ENVIRONMENT: preview");
    expectOrderedCommands(workflow, [
      "npm run cf:config:check",
      "npm run d1:migrate:preview",
      "npm run cf:build",
      "npm run cf:deploy:preview",
      "npm run cf:smoke",
    ]);
  });
});

describe("Preview family sharing E2E workflow(#151, #167)", () => {
  it("Draft Releaseの対象commitが、dispatchしたmainのHEADと一致することを求める", () => {
    const workflow = readWorkflow("preview-family-sharing-e2e.yml");

    // GitHub ActionsはDraft Releaseのcreatedイベントを発火しないため、
    // types: [created]に戻すとこのworkflowは動かなくなる(#167)。
    expect(workflow).not.toContain("types: [created]");
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain('RELEASE_TARGET_SHA" != "$GITHUB_SHA');
    expect(workflow).toContain("ref: ${{ steps.release.outputs.target_sha }}");

    expectOrderedCommands(workflow, [
      "Verify the Draft Release target",
      "playwright install",
      "npm run test:e2e:preview",
    ]);
  });

  it("preview環境へのdeployと同時に走らないよう、同じconcurrency groupを共有する", () => {
    expect(readWorkflow("preview-family-sharing-e2e.yml")).toContain("group: yamoru-preview");
    expect(readWorkflow("deploy-preview.yml")).toContain("group: yamoru-preview");
  });

  it("push毎に走るpreview deployへE2Eを持ち込まない", () => {
    const workflow = readWorkflow("deploy-preview.yml");

    expect(workflow).not.toContain("test:e2e:preview");
    expect(workflow).not.toContain("playwright");
  });
});

describe("Cloudflare production deploy workflow", () => {
  it("公開済みのstable Releaseだけを対象にする", () => {
    const workflow = readWorkflow("deploy-production.yml");

    expect(workflow).toContain("types: [published]");
    expect(workflow).not.toContain("workflow_run:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("github.event.release.draft == false");
    expect(workflow).toContain("github.event.release.prerelease == false");
  });

  it("Release tagのcommitを再検査し、tagとHEADの一致を確認してから配備する", () => {
    const workflow = readWorkflow("deploy-production.yml");

    expect(workflow).toContain("uses: ./.github/workflows/ci.yml");
    expect(workflow).toContain("needs: quality");
    expect(workflow).toContain("ref: ${{ github.event.release.tag_name }}");
    expect(workflow).toContain("RELEASE_TAG: ${{ github.event.release.tag_name }}");
  });

  it("production環境を指定し、公開境界の確認まで順に実行する", () => {
    const workflow = readWorkflow("deploy-production.yml");

    expect(workflow).toContain("YAMORU_APP_ENVIRONMENT: production");
    expectOrderedCommands(workflow, [
      "node scripts/release-target.ts",
      "npm run cf:config:check",
      "npm run d1:migrate:production",
      "npm run cf:build",
      "npm run cf:deploy:production",
      "npm run cf:smoke",
    ]);
  });
});

describe("配備workflowのSecretと公開URL", () => {
  it("Cloudflare認証情報と公開URLをEnvironmentから受け取り、AUTH_SECRETを渡さない", () => {
    for (const [fileName, environment, urlVariable] of [
      ["deploy-preview.yml", "name: preview", "vars.YAMORU_PREVIEW_URL"],
      ["deploy-production.yml", "name: production", "vars.YAMORU_PRODUCTION_URL"],
    ]) {
      const workflow = readWorkflow(fileName);

      expect(workflow).toContain(environment);
      expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
      expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
      expect(workflow).toContain(urlVariable);
      expect(workflow).not.toMatch(/AUTH_SECRET\s*:/u);
    }
  });
});
