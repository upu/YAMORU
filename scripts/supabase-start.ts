import { startSupabase } from "./supabase-cli.ts";

// `supabase start --workdir <dir>`をリトライ付きで呼ぶ薄いラッパー。
// prod:start/test:startから使う(Issue #86関連調査で見つかったDocker起動
// レースは、CIの型生成・ポリシーカタログ生成だけでなくローカルの通常起動
// にも起こりうるため)。

const workdir = process.argv[2];

if (!workdir) {
  throw new Error(
    "起動するSupabaseワークディレクトリを指定してください: node scripts/supabase-start.ts <workdir>",
  );
}

startSupabase(workdir);
