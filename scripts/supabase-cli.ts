import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// prodのconfig.tomlは55321〜55329のポートを使う。ここを別の帯へ
// 置き換えることで、prod・testと同居できる使い捨てワークディレクトリを作る。
const PROD_CONFIG_PORTS = [
  "55321", // api
  "55322", // db
  "55320", // db.shadow
  "55329", // db.pooler
  "55323", // studio
  "55324", // local_smtp
  "55327", // analytics
] as const;

// environments/prod/supabase/config.tomlを土台に、project_idとポート帯だけを
// 置き換えた使い捨てワークディレクトリのconfig.tomlを書き出す。他の設定
// (seed無効化、Realtime/Storage無効化など)はprodと同じものを引き継ぐため、
// 一時スタックの構成がprodから独りでにずれることがない。
//
// バックアップ復旧の検証(scripts/supabase-restore.ts)と型生成
// (scripts/supabase-gen-types.ts)が共有する。
export function writeDerivedConfig(options: {
  projectId: string;
  portPrefix: string;
  targetWorkdir: string;
}): void {
  const { portPrefix, projectId, targetWorkdir } = options;
  const template = readFileSync(
    join(envWorkdir("prod"), "supabase", "config.toml"),
    "utf8",
  );

  let patched = template.replace(
    /^project_id\s*=\s*"[^"]+"/m,
    `project_id = "${projectId}"`,
  );
  if (patched === template) {
    throw new Error(
      "prodのconfig.tomlからproject_idの行を見つけられませんでした。テンプレートを確認してください。",
    );
  }

  for (const port of PROD_CONFIG_PORTS) {
    const replaced = patched.replace(port, `${portPrefix}${port.slice(2)}`);
    if (replaced === patched) {
      throw new Error(
        `prodのconfig.tomlにポート${port}が見つかりませんでした。テンプレートを確認してください。`,
      );
    }
    patched = replaced;
  }

  const configDir = join(targetWorkdir, "supabase");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.toml"), patched);
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
