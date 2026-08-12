import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { envWorkdir, readProjectId, runSupabase } from "./supabase-cli.ts";

// prodのAuth利用者・publicスキーマのデータをバックアップする(Issue #31)。
//
// スキーマの正本はsupabase/migrations/であり、復元時はまずマイグレーション
// を適用してからこのバックアップ(データのみ)を読み込む想定のため、
// ここでは`--data-only`のダンプだけを作る。保存先はリポジトリ外の既定値
// (`~/.yamoru/backups/prod/`)で、`YAMORU_PROD_BACKUP_DIR`で上書きできる。
// タイムスタンプ付きファイル名で世代管理し、最新の1件だけに依存しない。

const EXPECTED_PROJECT_ID = "YAMORU-prod-local";

export function backupDir(): string {
  return process.env.YAMORU_PROD_BACKUP_DIR ?? join(homedir(), ".yamoru", "backups", "prod");
}

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = String(date.getFullYear());
  return (
    `${year}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function runBackup(): string {
  const workdir = envWorkdir("prod");
  const actual = readProjectId(workdir);

  if (actual !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `project_idが想定と異なります(期待値: ${EXPECTED_PROJECT_ID}, ` +
        `実際: ${actual})。バックアップを中止します。`,
    );
  }

  const dir = backupDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const file = join(dir, `yamoru-prod-${timestamp()}.sql`);

  runSupabase(
    ["db", "dump", "--local", "--data-only", "--schema", "auth,public", "-f", file],
    { workdir },
  );

  return file;
}

function main(): void {
  const file = runBackup();
  console.log(`バックアップを作成しました: ${file}`);
  console.log(
    "このファイルにはAuth利用者の認証情報・セッションおよび家庭の実データが含まれます。" +
      "リポジトリ外に保存されておりGitの追跡対象ではありませんが、取扱いには注意してください。",
  );
}

main();
