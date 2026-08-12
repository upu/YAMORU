import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  envWorkdir,
  getStatusEnv,
  readProjectId,
  runSupabase,
  writeDerivedConfig,
} from "./supabase-cli.ts";
import { syncMigrationsInto } from "./supabase-env-sync.ts";

// prodのバックアップを復元する(Issue #31)。
//
// 既定(--target verify)は、prodとは別の一時スタック
// (environments/restore-verify)へマイグレーションだけを適用してから
// バックアップのデータを読み込み、Auth利用者・家庭・membershipを
// 確認できる状態にする。prodそのものへは書き換えない。
//
// 実際にprodのデータを失って復旧する場合だけ、`--target prod`と
// 確認用の環境変数を明示して使う。

const REPO_ROOT = process.cwd();
const PROD_PROJECT_ID = "YAMORU-prod-local";
const VERIFY_PROJECT_ID = "YAMORU-restore-verify";

function verifyWorkdir(): string {
  return join(REPO_ROOT, "environments", "restore-verify");
}

function loadDumpIntoContainer(projectId: string, backupFile: string): void {
  const sql = readFileSync(backupFile);
  execFileSync(
    "docker",
    // -1 (--single-transaction)により、途中で失敗した場合は全体をロールバック
    // する。ON_ERROR_STOPだけでは失敗後も後続文が続行され、半端に復元された
    // 状態が残ってしまう。
    [
      "exec", "-i", `supabase_db_${projectId}`,
      "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-1",
    ],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );
}

function printVerificationCounts(projectId: string): void {
  const query =
    "select 'auth.users' as table_name, count(*) from auth.users " +
    "union all select 'households', count(*) from public.households " +
    "union all select 'household_members', count(*) from public.household_members;";

  const output = execFileSync(
    "docker",
    ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-c", query],
    { encoding: "utf8" },
  );
  console.log(output);
}

function restoreToVerify(backupFile: string): void {
  writeDerivedConfig({
    projectId: VERIFY_PROJECT_ID,
    portPrefix: "57",
    targetWorkdir: verifyWorkdir(),
  });
  syncMigrationsInto(join(verifyWorkdir(), "supabase"));

  console.log("一時検証スタックを起動します(migrationsのみ適用、seedなし)...");
  runSupabase(["start"], { workdir: verifyWorkdir() });

  console.log(`バックアップを読み込みます: ${backupFile}`);
  loadDumpIntoContainer(VERIFY_PROJECT_ID, backupFile);

  printVerificationCounts(VERIFY_PROJECT_ID);

  const status = getStatusEnv(verifyWorkdir());
  console.log("復元が完了しました。上記の件数とStudioでAuth利用者・家庭・membershipを確認してください。");
  console.log(`  Supabase Studio: ${status.studioUrl}`);
  console.log(`  DB接続文字列: ${status.dbUrl}`);
  console.log("確認が終わったら次のコマンドで一時スタックを停止してください。");
  console.log(`  npx supabase stop --workdir ${verifyWorkdir()}`);
}

function restoreToProd(backupFile: string): void {
  const confirmation = process.env.YAMORU_CONFIRM_PROD_RESTORE;
  if (confirmation !== PROD_PROJECT_ID) {
    throw new Error(
      "prodへの復元は破壊的な操作です。実行するには環境変数" +
        `YAMORU_CONFIRM_PROD_RESTOREに"${PROD_PROJECT_ID}"を設定してください。`,
    );
  }

  const workdir = envWorkdir("prod");
  const actual = readProjectId(workdir);
  if (actual !== PROD_PROJECT_ID) {
    throw new Error(
      `environments/prod/supabase/config.tomlのproject_idが想定と異なります` +
        `(期待値: ${PROD_PROJECT_ID}, 実際: ${actual})。復元を中止します。`,
    );
  }

  console.log("prodへバックアップのデータを読み込みます。");
  loadDumpIntoContainer(PROD_PROJECT_ID, backupFile);
  printVerificationCounts(PROD_PROJECT_ID);
  console.log("復元が完了しました。上記の件数とprod Studioで内容を確認してください。");
}

function main(): void {
  const args = process.argv.slice(2);
  const backupFile = args.find((arg) => !arg.startsWith("--"));
  const targetArg = args.find((arg) => arg.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1] : "verify";

  if (!backupFile || !existsSync(backupFile)) {
    throw new Error(
      "復元するバックアップファイルのパスを指定してください: " +
        "node scripts/supabase-restore.ts <backup.sql> [--target=verify|prod]",
    );
  }

  if (target === "verify") {
    restoreToVerify(backupFile);
  } else if (target === "prod") {
    restoreToProd(backupFile);
  } else {
    throw new Error(`--targetはverifyまたはprodを指定してください(渡された値: ${target})`);
  }
}

main();
