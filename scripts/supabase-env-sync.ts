import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// supabase/migrations, supabase/seed.sql, supabase/tests/ を正本とし、
// prod・testそれぞれのSupabase CLIワークディレクトリへ複製する。
//
// Supabase CLIは`<workdir>/supabase/migrations`のようにワークディレクトリ
// 直下の固定パスしかマイグレーション・seed・pgTAPテストの置き場所として
// 認識しないため、正本を一元管理しつつ複数ワークディレクトリで使うには
// この同期が必要になる。複製先は都度作り直すため、手動でのファイル管理は
// 発生しない(Issue #31)。

type Env = "prod" | "test";

const REPO_ROOT = process.cwd();
const CANONICAL_DIR = join(REPO_ROOT, "supabase");

function envDir(env: Env): string {
  return join(REPO_ROOT, "environments", env, "supabase");
}

function mirrorDir(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  if (!existsSync(source)) {
    return;
  }
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function mirrorFile(source: string, destination: string): void {
  rmSync(destination, { force: true });
  if (!existsSync(source)) {
    return;
  }
  mkdirSync(join(destination, ".."), { recursive: true });
  cpSync(source, destination);
}

// prod・test以外の一時ワークディレクトリ(バックアップ復旧の検証用など)へ、
// マイグレーションだけを複製する。scripts/supabase-restore.tsから使う。
export function syncMigrationsInto(targetSupabaseDir: string): void {
  mirrorDir(
    join(CANONICAL_DIR, "migrations"),
    join(targetSupabaseDir, "migrations"),
  );
}

export function syncSupabaseEnv(env: Env): void {
  const target = envDir(env);

  // マイグレーションはprod・test共通で常に最新の正本を複製する。
  syncMigrationsInto(target);

  // seed.sqlとpgTAPテストは、架空fixtureを扱うtestだけが必要とする。
  // prodのワークディレクトリには複製しないことで、`[db.seed] enabled = false`
  // に加えてファイル面でもfixture投入を構造的に防ぐ。
  if (env === "test") {
    mirrorFile(join(CANONICAL_DIR, "seed.sql"), join(target, "seed.sql"));
    mirrorDir(join(CANONICAL_DIR, "tests"), join(target, "tests"));
  }
}

function main(): void {
  const env = process.argv[2];
  if (env !== "prod" && env !== "test") {
    throw new Error(
      `第一引数にはprodまたはtestを指定してください(渡された値: ${env})`,
    );
  }
  syncSupabaseEnv(env);
  console.log(`supabase/ の正本を environments/${env}/supabase/ へ同期しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
