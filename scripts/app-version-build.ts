import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_ENVIRONMENTS,
  type AppEnvironment,
  type AppVersionInfo,
  buildAppVersionInfo,
} from "../src/app/app-version.ts";

const STABLE_VERSION_SOURCE = /^v?\d+\.\d+\.\d+$/u;
const COMMIT_ID = /^[0-9a-f]{7,40}$/iu;

type AppVersionBuildInput = {
  buildId?: string;
  environment?: string;
  explicitVersion?: string;
  fallbackVersion: string;
  nearestStableTag?: string;
};

function normalizeVersion(value: string): string {
  if (!STABLE_VERSION_SOURCE.test(value)) {
    throw new Error("YAMORUのバージョンはvX.Y.ZまたはX.Y.Z形式でなければなりません。");
  }
  return value.startsWith("v") ? value.slice(1) : value;
}

export function resolveAppVersionBuildInfo(
  input: AppVersionBuildInput,
): AppVersionInfo {
  const environment = input.environment ?? "local";
  if (!APP_ENVIRONMENTS.includes(environment as AppEnvironment)) {
    throw new Error("YAMORUの環境名はlocal、preview、productionのいずれかです。");
  }

  const rawBuildId = input.buildId?.trim() ?? "unknown";
  if (rawBuildId !== "unknown" && !COMMIT_ID.test(rawBuildId)) {
    throw new Error("YAMORUのビルド識別子はGit commit SHAでなければなりません。");
  }

  return buildAppVersionInfo({
    buildId: rawBuildId === "unknown" ? rawBuildId : rawBuildId.slice(0, 7).toLowerCase(),
    environment: environment as AppEnvironment,
    version: normalizeVersion(
      input.explicitVersion ?? input.nearestStableTag ?? input.fallbackVersion,
    ),
  });
}

function readGitValue(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.jsonにversionがありません。");
  }
  return packageJson.version;
}

export function loadAppVersionBuildInfo(): AppVersionInfo {
  return resolveAppVersionBuildInfo({
    buildId: process.env.YAMORU_BUILD_ID ?? readGitValue(["rev-parse", "HEAD"]),
    environment: process.env.YAMORU_APP_ENVIRONMENT,
    explicitVersion: process.env.YAMORU_APP_VERSION,
    fallbackVersion: readPackageVersion(),
    nearestStableTag: readGitValue([
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v[0-9]*.[0-9]*.[0-9]*",
    ]),
  });
}
