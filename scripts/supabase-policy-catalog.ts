import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSupabase, startSupabase, writeDerivedConfig } from "./supabase-cli.ts";
import { syncMigrationsInto } from "./supabase-env-sync.ts";

// public スキーマ上の現在有効なRLSポリシー一覧を、pg_policyと`comment on policy`
// (DBコメント)から生成する(Issue #57)。型生成(supabase-gen-types.ts)と同じ
// 「生成物 + CIドリフト検知」方式を踏襲する。
//
// RLSポリシーはlib/supabase/database.types.tsに現れない(型生成の対象はテーブルの
// 形と関数のシグネチャだけ)。ポリシーの定義そのものの正本はsupabase/migrations/の
// SQLのままだが、「今どんなポリシーがあり、なぜあるか」を一覧できる場所がなかった。
//
// 生成元は型生成と同じ理由(コミット済みマイグレーションだけから再現できる)で
// 使い捨てのSupabaseスタックとする。`comment on policy`が付いていないポリシーが
// 1件でもあれば、内容のズレとは別の理由として失敗する(既定の生成・`--check`の
// どちらでも)。マイグレーションで新しいポリシーを追加してコメントを付け忘れると
// ここで検出される。

const REPO_ROOT = process.cwd();
const PROJECT_ID = "YAMORU-policy-catalog";
const PORT_PREFIX = "54";
const OUTPUT_PATH = join(REPO_ROOT, "docs", "references", "rls-policy-catalog.md");
const OUTPUT_RELATIVE = "docs/references/rls-policy-catalog.md";

const HEADER = `---
type: Reference
title: 現在有効なRLSポリシー一覧
description: public スキーマの現在有効なRow Level Securityポリシーを、pg_policyとDBコメント(comment on policy)から一覧する自動生成カタログ
tags: [yamoru, supabase, database, rls]
status: stable
generated: true
---

<!--
  自動生成ファイル。手で編集しない(Issue #57)。

  supabase/migrations/を適用した使い捨てSupabaseスタックのpg_policyと
  comment on policyから \`npm run gen:policies\` で生成する。ポリシーを
  追加・変更したら再生成し、マイグレーションと同じコミットに含めること。
  ズレは \`npm run gen:policies:check\`(CIでも実行)が検出する。

  ポリシーの定義そのものの正本はsupabase/migrations/の各SQL、境界が実際に
  効いていることの正本はsupabase/tests/database/のpgTAPテストである。
  このカタログは「今どんなポリシーがあり、なぜあるか」の一覧に限る。
-->

# 現在有効なRLSポリシー一覧
`;

const CATALOG_QUERY = `
select coalesce(json_agg(t order by t.table_name, t.policy_name), '[]'::json)
from (
  select
    pc.relname as table_name,
    pol.polname as policy_name,
    case pol.polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
      else pol.polcmd::text
    end as command,
    case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as permissive,
    case
      when 0 = any(pol.polroles) then array['public']
      else (
        select array_agg(r.rolname order by r.rolname)
        from pg_roles r
        where r.oid = any(pol.polroles)
      )
    end as roles,
    obj_description(pol.oid, 'pg_policy') as description
  from pg_policy pol
  join pg_class pc on pc.oid = pol.polrelid
  join pg_namespace pn on pn.oid = pc.relnamespace
  where pn.nspname = 'public'
) t;
`;

interface PolicyRow {
  table_name: string;
  policy_name: string;
  command: string;
  permissive: string;
  roles: string[];
  description: string | null;
}

function workdir(): string {
  return join(REPO_ROOT, "environments", "policy-catalog");
}

// 改行はLFへ揃え、末尾の空行を1つに正規化する。Windowsではチェックアウト時に
// CRLFへ変換されるため、正規化しないと内容が同じでも差分ありと誤判定する。
function normalize(source: string): string {
  return `${source.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

// バックスラッシュ自身を先にエスケープしないと、`\`を含む値の直後に`|`が
// 続いた場合に意図しない結合したエスケープ列(`\|`)として解釈され得る。
function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toMarkdown(rows: PolicyRow[]): string {
  const lines = [
    "| テーブル | ポリシー | 操作 | 対象ロール | 意図(comment on policy) |",
    "|---|---|---|---|---|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.table_name} | ${row.policy_name} | ${row.command}${row.permissive === "RESTRICTIVE" ? " (RESTRICTIVE)" : ""} | ${row.roles.join(", ")} | ${escapeCell(row.description ?? "")} |`,
    );
  }

  return `${HEADER}\n${lines.join("\n")}\n`;
}

function queryPolicies(): PolicyRow[] {
  writeDerivedConfig({
    portPrefix: PORT_PREFIX,
    projectId: PROJECT_ID,
    targetWorkdir: workdir(),
  });
  syncMigrationsInto(join(workdir(), "supabase"));

  console.log("RLSポリシーカタログ用の使い捨てスタックを起動します(migrationsのみ適用)...");
  startSupabase(workdir());

  try {
    const output = execFileSync(
      "docker",
      [
        "exec",
        `supabase_db_${PROJECT_ID}`,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-tAc",
        CATALOG_QUERY,
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(output.trim()) as PolicyRow[];
  } finally {
    // --no-backupでデータ量も破棄し、次回の生成が前回の状態を引き継がないようにする。
    runSupabase(["stop", "--no-backup"], { workdir: workdir() });
  }
}

function reportMissingComments(rows: PolicyRow[]): boolean {
  const missing = rows.filter((row) => row.description === null);

  if (missing.length === 0) {
    return false;
  }

  console.error(
    "次のRLSポリシーに`comment on policy ... is '...'`が付いていません。" +
      "追加したマイグレーションで意図をコメントとして残してください:",
  );
  for (const row of missing) {
    console.error(`  - ${row.table_name}.${row.policy_name}`);
  }
  process.exitCode = 1;
  return true;
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
    console.error(`${OUTPUT_RELATIVE}が存在しません。\`npm run gen:policies\`を実行してコミットしてください。`);
    process.exitCode = 1;
    return;
  }

  if (committed !== generated) {
    console.error(
      `${OUTPUT_RELATIVE}がsupabase/migrations/の内容とずれています。\n` +
        "`npm run gen:policies`を実行し、生成結果をマイグレーションと同じコミットに含めてください。",
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
  const rows = queryPolicies();

  if (reportMissingComments(rows)) {
    return;
  }

  const generated = normalize(toMarkdown(rows));

  if (isCheck) {
    check(generated);
  } else {
    write(generated);
  }
}

main();
