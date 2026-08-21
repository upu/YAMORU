import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

import {
  assertRemoteTargetConfirmation,
  assertRemoteTargetReady,
  getRemoteD1MigrationArgs,
  parseCloudflareTargets,
  type RemoteCloudflareEnvironment,
} from "./cloudflare-target.ts";

type CloudflareCommand = "check" | "deploy" | "migrate";

function loadTargets() {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"),
  ) as unknown;
  return parseCloudflareTargets(config);
}

function parseInvocation(args: string[]): {
  command: CloudflareCommand;
  environment?: RemoteCloudflareEnvironment;
} {
  if (args.length === 1 && args[0] === "check") return { command: "check" };
  if (
    args.length === 2 &&
    (args[0] === "deploy" || args[0] === "migrate") &&
    (args[1] === "preview" || args[1] === "production")
  ) {
    return { command: args[0], environment: args[1] };
  }
  throw new Error("Usage: cloudflare <check|deploy|migrate> [preview|production]");
}

async function readConfirmation(
  environment: RemoteCloudflareEnvironment,
): Promise<string> {
  const expected = `yamoru-${environment}`;
  if (process.env.CI === "true") return expected;

  if (process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await prompt.question(`操作対象の確認として ${expected} を入力: `);
    } finally {
      prompt.close();
    }
  }

  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  return input.trim();
}

function runNodeScript(scriptPath: string, args: string[]): void {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Cloudflare command failed with exit code ${String(result.status)}`);
  }
}

async function main(): Promise<void> {
  const invocation = parseInvocation(process.argv.slice(2));
  const targets = loadTargets();

  if (invocation.command === "check") {
    assertRemoteTargetReady(targets.preview);
    assertRemoteTargetReady(targets.production);
    process.stdout.write("preview / productionのWorker名とD1 bindingを確認しました。\n");
    return;
  }

  const environment = invocation.environment;
  if (environment === undefined) throw new Error("Cloudflare環境が必要です。");
  const target = targets[environment];
  assertRemoteTargetReady(target);
  assertRemoteTargetConfirmation(environment, await readConfirmation(environment));

  if (invocation.command === "migrate") {
    runNodeScript(
      join(process.cwd(), "node_modules/wrangler/bin/wrangler.js"),
      getRemoteD1MigrationArgs(targets, environment),
    );
    return;
  }

  runNodeScript(
    join(
      process.cwd(),
      "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
    ),
    ["deploy", "--env", environment, "--keep-vars"],
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Cloudflare操作に失敗しました。";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
