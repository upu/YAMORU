import { spawnSync } from "node:child_process";

import {
  assertReleaseTarget,
  assertStableReleaseTag,
} from "./release-target-contract.ts";

function runGit(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? "command"}に失敗しました。`);
  }
  return result.stdout.trim();
}

function isHeadOnMain(): boolean {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", "HEAD", "origin/main"],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("mainとの祖先関係を確認できませんでした。");
  }
  return result.status === 0;
}

function main(): void {
  const tagName = process.env.RELEASE_TAG;
  if (tagName === undefined) throw new Error("RELEASE_TAGが設定されていません。");
  assertStableReleaseTag(tagName);

  assertReleaseTarget({
    headCommit: runGit(["rev-parse", "HEAD"]),
    isOnMain: isHeadOnMain(),
    tagCommit: runGit(["rev-parse", `refs/tags/${tagName}^{commit}`]),
    tagName,
  });
  process.stdout.write(`${tagName}が指すmain上のcommitを確認しました。\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Release対象の確認に失敗しました。";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
