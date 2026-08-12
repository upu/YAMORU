import { describe, expect, it } from "vitest";

import { parseAllowedDevOrigins } from "../lib/dev-origins";

describe("開発用接続元の設定", () => {
  it("カンマ区切りのホスト名を空白を除いて読み取る", () => {
    expect(parseAllowedDevOrigins("192.168.1.10, dev.example.test ")).toEqual([
      "192.168.1.10",
      "dev.example.test",
    ]);
  });

  it("未設定なら許可対象を追加しない", () => {
    expect(parseAllowedDevOrigins(undefined)).toEqual([]);
  });
});
