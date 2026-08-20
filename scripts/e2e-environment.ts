import { pathToFileURL } from "node:url";

import { envWorkdir, getStatusEnv, readProjectId } from "./supabase-cli.ts";

export const EXPECTED_E2E_PROJECT_ID = "YAMORU-test";
export const EXPECTED_E2E_SUPABASE_URL = "http://127.0.0.1:58321";

export function assertE2ETestProjectId(projectId: string): void {
  if (projectId !== EXPECTED_E2E_PROJECT_ID) {
    throw new Error(
      `E2Eはproject_id="${EXPECTED_E2E_PROJECT_ID}"だけを対象にします` +
        `(実際: "${projectId}")。開始前に中止しました。`,
    );
  }
}

export function assertE2ETestSupabaseUrl(supabaseUrl: string): void {
  if (supabaseUrl !== EXPECTED_E2E_SUPABASE_URL) {
    throw new Error(
      `E2Eは${EXPECTED_E2E_SUPABASE_URL}だけを対象にします` +
        `(実際: "${supabaseUrl}")。開始前に中止しました。`,
    );
  }
}

export function assertE2ETestProject({
  projectId,
  supabaseUrl,
}: {
  projectId: string;
  supabaseUrl: string;
}): void {
  assertE2ETestProjectId(projectId);
  assertE2ETestSupabaseUrl(supabaseUrl);
}

export function getE2ETestEnvironment(): {
  publishableKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
} {
  const workdir = envWorkdir("test");
  const projectId = readProjectId(workdir);
  // project_idを先に検証し、取り違え時はSupabase CLIへ接続する前に停止する。
  assertE2ETestProjectId(projectId);
  const status = getStatusEnv(workdir);
  assertE2ETestSupabaseUrl(status.url);

  return {
    publishableKey: status.publishableKey,
    serviceRoleKey: status.serviceRoleKey,
    supabaseUrl: status.url,
  };
}

function main(): void {
  const environment = getE2ETestEnvironment();
  console.log(
    `E2E接続先を確認しました(project_id: ${EXPECTED_E2E_PROJECT_ID}, URL: ${environment.supabaseUrl})。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
