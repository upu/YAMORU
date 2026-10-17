import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getOAuthRuntime } from "../oauth/runtime";
import type { McpDependencies } from "./http";
function allowedOrigins(value: string | undefined) {
  return (value ?? "").split(/[\s,]+/u).filter(Boolean).flatMap((entry) => {
    try {
      const url = new URL(entry);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? [url.origin] : [];
    } catch { return []; }
  });
}
export async function getMcpRuntime(): Promise<McpDependencies> {
  const runtime = await getOAuthRuntime();
  const { env } = await getCloudflareContext({ async: true });
  return { ...runtime, cursorSecret: process.env.AUTH_SECRET ?? env.AUTH_SECRET, allowedOrigins: allowedOrigins(env.YAMORU_MCP_ALLOWED_ORIGINS) };
}
