import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  envWorkdir,
  getStatusEnv,
  readProjectId,
  runSupabase,
  startSupabase,
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
  const sql = Buffer.concat([
    Buffer.from("SET session_replication_role = replica;\n"),
    readFileSync(backupFile),
    Buffer.from("\nSET session_replication_role = origin;\n"),
  ]);
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

  const integrityQuery = `
    select
      (select count(*) from public.household_members m
        left join public.households h on h.id = m.household_id
        left join auth.users u on u.id = m.user_id
        where h.id is null or u.id is null)
      + (select count(*) from public.profiles p
        left join auth.users u on u.id = p.user_id where u.id is null)
      + (select count(*) from public.managed_items i
        left join public.households h on h.id = i.household_id where h.id is null)
      + (select count(*) from public.external_links l
        left join public.managed_items i on i.id = l.managed_item_id
        where i.id is null or i.household_id <> l.household_id)
      + (select count(*) from public.task_rules r
        left join public.households h on h.id = r.household_id
        left join public.managed_items i on i.id = r.managed_item_id
        where h.id is null or (r.managed_item_id is not null and
          (i.id is null or i.household_id <> r.household_id)))
      + (select count(*) from public.task_occurrences o
        left join public.task_rules r on r.id = o.task_rule_id
        where r.id is null or r.household_id <> o.household_id)
      + (select count(*) from public.activity_logs l
        left join public.task_occurrences o on o.id = l.task_occurrence_id
        where o.id is null or o.household_id <> l.household_id)
      + (select count(*) from public.household_invitations i
        left join public.households h on h.id = i.household_id where h.id is null)
      as orphan_count;`;
  const orphanCount = execFileSync(
    "docker",
    [
      "exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres",
      "-At", "-v", "ON_ERROR_STOP=1", "-c", integrityQuery,
    ],
    { encoding: "utf8" },
  ).trim();
  if (orphanCount !== "0") {
    throw new Error("バックアップ復元後の参照整合性チェックに失敗しました。");
  }
  console.log("参照整合性を確認しました(orphan_count: 0)。");
}

function resetVerifyStack(): void {
  try {
    runSupabase(["stop", "--no-backup"], {
      workdir: verifyWorkdir(),
      stdio: "pipe",
    });
  } catch {
    // 初回実行など、対象スタックが存在しない場合はそのまま新規作成する。
  }
}

function restoreToVerify(backupFile: string): void {
  resetVerifyStack();
  writeDerivedConfig({
    projectId: VERIFY_PROJECT_ID,
    portPrefix: "57",
    targetWorkdir: verifyWorkdir(),
  });
  syncMigrationsInto(join(verifyWorkdir(), "supabase"));

  console.log("一時検証スタックを起動します(migrationsのみ適用、seedなし)...");
  startSupabase(verifyWorkdir(), { quiet: true });

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
