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

const START_MAX_ATTEMPTS = 3;
const START_RETRY_DELAY_MS = 3000;

// Node標準APIだけで完結する同期スリープ。execFileSyncベースの本ファイルの
// スタイルに合わせ、この関数だけのためにasync/awaitへ書き換えない
// (OS依存のsleepコマンドを呼ぶより、Windows/Linux両方で同じ挙動になる)。
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// execFileSyncは失敗時、シグナルで終了した場合`error.signal`を持たせる。
// Ctrl+Cなど利用者による中断は、起動そのものの失敗ではないため再試行の
// 対象から外し、直ちに伝播させる(Codexレビュー指摘、PR #88)。
function isSignalTerminated(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "signal" in error &&
    error.signal != null
  );
}

// 失敗した起動が残した可能性のある部分的なコンテナを、次の再試行の前に
// 片付ける。後始末自体の失敗は元のエラーを覆い隠さないよう握りつぶす
// (次のstartがCLI自身の内部クリーンアップで拾えなくても、握りつぶした
// stopの失敗より起動失敗の原因を優先して見せたいため)。
function stopSupabaseBestEffort(workdir: string): void {
  try {
    runSupabase(["stop", "--no-backup"], { workdir });
  } catch {
    // 意図的に無視する。
  }
}

// `supabase start`は、直前のコンテナのポート開放がまだ終わっていない状態で
// 次のバインドが走ると「address already in use」で失敗することがある
// (GitHub Actionsのホスト型ランナーで実際に観測。Issue #86関連調査)。原因を
// 問わず起動失敗全般を対象に、短い待機を挟んで数回まで自動再試行する。
// CI(型生成・RLSポリシーカタログ生成)・ローカルのprod/test起動・バックアップ
// 復元検証など、スタックを起動するすべての経路がこの関数を通る想定。
export function startSupabase(workdir: string): void {
  for (let attempt = 1; attempt <= START_MAX_ATTEMPTS; attempt += 1) {
    try {
      runSupabase(["start"], { workdir });
      return;
    } catch (error) {
      if (isSignalTerminated(error) || attempt === START_MAX_ATTEMPTS) throw error;
      console.error(
        `supabase startに失敗しました(${String(attempt)}/${String(START_MAX_ATTEMPTS)}回目)。` +
          `${String(START_RETRY_DELAY_MS / 1000)}秒待ってから再試行します。`,
      );
      // 設定不備・migration失敗など非一過性のエラーでも、後始末なしの
      // 再実行が別の紛らわしいエラーに化けることを避ける(Codexレビュー指摘)。
      stopSupabaseBestEffort(workdir);
      sleepSync(START_RETRY_DELAY_MS);
    }
  }
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
