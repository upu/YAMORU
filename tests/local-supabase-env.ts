import { envWorkdir, getStatusEnv } from "../scripts/supabase-cli.ts";

// 自動テストは常にtest環境(environments/test)のローカルSupabaseへ接続する。
// prodのURLやキーを使わないことをここで構造的に保証する(Issue #31)。
export function getLocalSupabaseEnv(): {
  publishableKey: string;
  serviceRoleKey: string;
  url: string;
} {
  const status = getStatusEnv(envWorkdir("test"));

  return {
    publishableKey: status.publishableKey,
    serviceRoleKey: status.serviceRoleKey,
    url: status.url,
  };
}
