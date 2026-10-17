import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

import { resolveOAuthConfig, type OAuthConfig } from "./config";

export type OAuthRuntime = { config: OAuthConfig | null; db: D1Database };

// 同意画面(Server Component・Server Action)とendpoint(Route Handler)で
// issuerが食い違うと、同意時に束縛したresourceとtoken交換時の値が一致せず
// 交換できない。どちらも同じ方法、すなわち招待リンクの生成
// (household/invitation-actions.ts)と同じHostと転送元のスキームから
// オリジンを組み立てる。
export async function getOAuthRuntime(): Promise<OAuthRuntime> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  const { env } = await getCloudflareContext({ async: true });
  return { config: resolveOAuthConfig(new URL(`${protocol}://${host}/`), env), db: env.DB };
}
