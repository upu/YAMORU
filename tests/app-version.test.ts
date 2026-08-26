import { describe, expect, it } from "vitest";

import {
  buildAppVersionInfo,
  formatDetailedAppVersion,
} from "../src/app/app-version";
import { resolveAppVersionBuildInfo } from "../scripts/app-version-build";

describe("アプリバージョンの生成(Issue #221)", () => {
  it("productionはRelease tagとcommitから公開用の値だけを生成する", () => {
    expect(resolveAppVersionBuildInfo({
      buildId: "ABCDEF1234567890",
      environment: "production",
      explicitVersion: "v0.9.0",
      fallbackVersion: "0.1.0",
      nearestStableTag: "v0.8.0",
    })).toEqual({
      buildId: "abcdef1",
      environment: "production",
      version: "0.9.0",
    });
  });

  it("previewは直近のstable tagと現在のcommitを組み合わせる", () => {
    expect(resolveAppVersionBuildInfo({
      buildId: "e1749858f55a4e41308e6fa804545deaeb5ec74e",
      environment: "preview",
      fallbackVersion: "0.1.0",
      nearestStableTag: "v0.8.0",
    })).toEqual({
      buildId: "e174985",
      environment: "preview",
      version: "0.8.0",
    });
  });

  it("git情報がないlocal buildはpackage versionと安全な既定値を使う", () => {
    expect(resolveAppVersionBuildInfo({
      fallbackVersion: "0.1.0",
    })).toEqual({
      buildId: "unknown",
      environment: "local",
      version: "0.1.0",
    });
  });

  it("不正な環境名・版番号・build識別子をビルドに混入させない", () => {
    expect(() => resolveAppVersionBuildInfo({
      environment: "private-production-config",
      fallbackVersion: "0.1.0",
    })).toThrow(/環境名/u);
    expect(() => resolveAppVersionBuildInfo({
      explicitVersion: "secret-value",
      fallbackVersion: "0.1.0",
    })).toThrow(/バージョン/u);
    expect(() => resolveAppVersionBuildInfo({
      buildId: "not-a-commit",
      fallbackVersion: "0.1.0",
    })).toThrow(/ビルド識別子/u);
  });

  it("支援依頼でそのまま伝えられる一行表記を作る", () => {
    const versionInfo = buildAppVersionInfo({
      buildId: "e174985",
      environment: "preview",
      version: "0.8.0",
    });

    expect(formatDetailedAppVersion(versionInfo)).toBe(
      "YAMORU 0.8.0 · preview · e174985",
    );
  });
});
