import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSupabase, startSupabase, writeDerivedConfig } from "./supabase-cli.ts";
import { syncMigrationsInto } from "./supabase-env-sync.ts";

// supabase/migrations/の累積結果からTypeScript型を生成する(Issue #45)。
//
// 生成元は必ず使い捨てのSupabaseスタック(environments/gen-types)とする。
// 稼働中のprod・test環境は、未コミットのマイグレーションが適用されていたり
// 手動操作でずれていたりする可能性があり、そこから生成すると
// 「コミット済みマイグレーションだけから再現できる」という前提が崩れる。
// 使い捨てスタックなら、生成物はローカルでもCIでも同じ入力から決まる。
//
// 既定は生成してファイルへ書き出す。`--check`はファイルを書き換えず、
// コミット済みの内容と一致するかだけを検証する(CIでのズレ検知)。

const REPO_ROOT = process.cwd();
const PROJECT_ID = "YAMORU-gen-types";
const PORT_PREFIX = "59";
const OUTPUT_PATH = join(REPO_ROOT, "lib", "supabase", "database.types.ts");
const OUTPUT_RELATIVE = "lib/supabase/database.types.ts";

const HEADER = `// 自動生成ファイル。手で編集しない(Issue #45)。
//
// supabase/migrations/を適用した使い捨てSupabaseスタックから
// \`npm run gen:types\`で生成する。スキーマを変更したら再生成し、
// マイグレーションと同じコミットに含めること。ズレは\`npm run gen:types:check\`
// (CIでも実行)が検出する。
`;

function workdir(): string {
  return join(REPO_ROOT, "environments", "gen-types");
}

// 改行はLFへ揃え、末尾の空行を1つに正規化する。Windowsではチェックアウト時に
// CRLFへ変換されるため、正規化しないと内容が同じでも差分ありと誤判定する。
function normalize(source: string): string {
  return `${source.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

function generateFromDisposableStack(): string {
  writeDerivedConfig({
    portPrefix: PORT_PREFIX,
    projectId: PROJECT_ID,
    targetWorkdir: workdir(),
  });
  syncMigrationsInto(join(workdir(), "supabase"));

  console.log("型生成用の使い捨てスタックを起動します(migrationsのみ適用)...");
  startSupabase(workdir());

  try {
    const generated = runSupabase(["gen", "types", "typescript", "--local"], {
      stdio: "pipe",
      workdir: workdir(),
    });
    return normalize(`${HEADER}\n${normalize(generated)}`);
  } finally {
    // --no-backupでデータ量も破棄し、次回の生成が前回の状態を引き継がないようにする。
    runSupabase(["stop", "--no-backup"], { workdir: workdir() });
  }
}

function readCommitted(): string | null {
  if (!existsSync(OUTPUT_PATH)) {
    return null;
  }
  return normalize(readFileSync(OUTPUT_PATH, "utf8"));
}

function check(generated: string): void {
  const committed = readCommitted();

  if (committed === null) {
    console.error(`${OUTPUT_RELATIVE}が存在しません。\`npm run gen:types\`を実行してコミットしてください。`);
    process.exitCode = 1;
    return;
  }

  if (committed !== generated) {
    console.error(
      `${OUTPUT_RELATIVE}がsupabase/migrations/の内容とずれています。\n` +
        "`npm run gen:types`を実行し、生成結果をマイグレーションと同じコミットに含めてください。",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`${OUTPUT_RELATIVE}はsupabase/migrations/と一致しています。`);
}

function write(generated: string): void {
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`${OUTPUT_RELATIVE}を生成しました。`);
}

function main(): void {
  const isCheck = process.argv.includes("--check");
  const generated = generateFromDisposableStack();

  if (isCheck) {
    check(generated);
  } else {
    write(generated);
  }
}

main();
