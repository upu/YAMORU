import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseServiceRoleEnv } from "./env";

// Issue #70: open_invitation_claim / accept_household_invitation_by_claimは
// service_roleだけに実行権限を絞った「サーバー専用境界」のRPCになった。
// anon/authenticatedキーを使うlib/supabase/server.tsのクライアントでは
// 呼べない(permission denied)。この関数はNext.jsのRoute Handler /
// Server Actionからだけ呼び、ブラウザへ届くバンドルには含めない
// ("server-only" importがビルド時にそれを強制する)。
//
// service_roleはRLSを無視するため、呼び出し元は必ず限定的な用途
// (このIssueの2 RPCの呼び出し)だけに使い、任意のテーブル操作には使わない。
export function createServiceRoleClient() {
  const { serviceRoleKey, url } = getSupabaseServiceRoleEnv();

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
