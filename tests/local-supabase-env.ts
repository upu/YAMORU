import { execFileSync } from "node:child_process";
import { join } from "node:path";

function readEnvValue(output: string, name: string): string {
  const value = new RegExp(`^${name}="([^"]+)"$`, "m").exec(output)?.[1];

  if (!value) {
    throw new Error(`ローカルSupabaseの${name}を取得できませんでした。`);
  }

  return value;
}

export function getLocalSupabaseEnv(): {
  publishableKey: string;
  url: string;
} {
  const cliPath = join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const output = execFileSync(process.execPath, [cliPath, "status", "-o", "env"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });

  return {
    publishableKey: readEnvValue(output, "PUBLISHABLE_KEY"),
    url: readEnvValue(output, "API_URL"),
  };
}
