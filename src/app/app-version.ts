export const APP_ENVIRONMENTS = ["local", "preview", "production"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type AppVersionInfo = {
  buildId: string;
  environment: AppEnvironment;
  version: string;
};

const STABLE_VERSION = /^\d+\.\d+\.\d+$/u;
const SAFE_BUILD_ID = /^(?:[0-9a-f]{7}|unknown)$/u;

export function buildAppVersionInfo(input: AppVersionInfo): AppVersionInfo {
  if (!STABLE_VERSION.test(input.version)) {
    throw new Error("YAMORUの公開バージョンはX.Y.Z形式でなければなりません。");
  }
  if (!APP_ENVIRONMENTS.includes(input.environment)) {
    throw new Error("YAMORUの環境名が不正です。");
  }
  if (!SAFE_BUILD_ID.test(input.buildId)) {
    throw new Error("YAMORUのビルド識別子が不正です。");
  }
  return input;
}

export function formatDetailedAppVersion(versionInfo: AppVersionInfo): string {
  return `YAMORU ${versionInfo.version} · ${versionInfo.environment} · ${versionInfo.buildId}`;
}

export const APP_VERSION_INFO = buildAppVersionInfo({
  buildId: process.env.NEXT_PUBLIC_YAMORU_BUILD_ID ?? "unknown",
  environment: (process.env.NEXT_PUBLIC_YAMORU_ENVIRONMENT ?? "local") as AppEnvironment,
  version: process.env.NEXT_PUBLIC_YAMORU_VERSION ?? "0.0.0",
});
