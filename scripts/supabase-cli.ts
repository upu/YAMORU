import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// prod/testの各スクリプトとtests/local-supabase-env.tsが共通で使う
// Supabase CLI呼び出しのヘルパー。CLIは`devDependencies`に固定バージョンで
// 含まれているため、パス解決はリポジトリ内の実体を直接指す。

export const SUPABASE_CLI_PATH = join(
  process.cwd(),
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);

export function envWorkdir(env: "prod" | "test"): string {
  return join(process.cwd(), "environments", env);
}

export function runSupabase(
  args: string[],
  options: { workdir?: string; stdio?: "inherit" | "pipe" } = {},
): string {
  const fullArgs = options.workdir
    ? [SUPABASE_CLI_PATH, ...args, "--workdir", options.workdir]
    : [SUPABASE_CLI_PATH, ...args];

  return execFileSync(process.execPath, fullArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
}

function readEnvValue(output: string, name: string): string {
  const value = new RegExp(`^${name}="([^"]+)"$`, "m").exec(output)?.[1];

  if (!value) {
    throw new Error(`ローカルSupabaseの${name}を取得できませんでした。`);
  }

  return value;
}

export function getStatusEnv(workdir: string): {
  publishableKey: string;
  serviceRoleKey: string;
  url: string;
  dbUrl: string;
  studioUrl: string;
} {
  const output = execFileSync(
    process.execPath,
    [SUPABASE_CLI_PATH, "status", "-o", "env", "--workdir", workdir],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    },
  );

  return {
    publishableKey: readEnvValue(output, "PUBLISHABLE_KEY"),
    serviceRoleKey: readEnvValue(output, "SERVICE_ROLE_KEY"),
    url: readEnvValue(output, "API_URL"),
    dbUrl: readEnvValue(output, "DB_URL"),
    studioUrl: readEnvValue(output, "STUDIO_URL"),
  };
}

// config.tomlは完全なTOMLとしては解析せず、`project_id = "..."`の行だけを
// 読む。破壊的操作の直前にワークディレクトリの取り違えを検出する用途に
// 限定しているため、この程度の単純な読み取りで十分とする。
export function readProjectId(workdir: string): string {
  const configPath = join(workdir, "supabase", "config.toml");
  const content = readFileSync(configPath, "utf8");
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(content);

  if (!match) {
    throw new Error(`${configPath}からproject_idを読み取れませんでした。`);
  }

  return match[1];
}
