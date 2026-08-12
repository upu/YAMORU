import { envWorkdir, readProjectId } from "./supabase-cli.ts";

// test:db:reset・test:dbなど破壊的操作の直前に必ず通すガード。
//
// prodを対象とするreset系コマンドは用意しない方針(Issue #31)そのものに
// 加えて、このスクリプト自身もtest以外を一切許可しない。npm scriptの
// 引数を書き換えるミスや、将来の変更でprod向けにこのガードを流用しようと
// した場合でも、ここで必ず停止する。

const DESTRUCTIVE_ALLOWED_ENV = "test";
const EXPECTED_PROJECT_ID = "YAMORU-test";

function main(): void {
  const env = process.argv[2];

  if (env !== DESTRUCTIVE_ALLOWED_ENV) {
    throw new Error(
      `破壊的操作は"${DESTRUCTIVE_ALLOWED_ENV}"環境だけに許可しています` +
        `(渡された値: ${env})。処理を中止します。`,
    );
  }

  const workdir = envWorkdir(env);
  const actual = readProjectId(workdir);

  if (actual !== EXPECTED_PROJECT_ID) {
    throw new Error(
      "接続先の取り違えを検出しました。" +
        `environments/${env}/supabase/config.tomlのproject_idは` +
        `"${EXPECTED_PROJECT_ID}"である必要がありますが、` +
        `実際は"${actual}"でした。破壊的操作を中止します。`,
    );
  }

  console.log(
    `接続先を確認しました(project_id: ${actual})。破壊的操作を続行します。`,
  );
}

main();
