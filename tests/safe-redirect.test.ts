import { describe, expect, it } from "vitest";

import { toSafeRedirectPath } from "../src/lib/auth/safe-redirect";

describe("toSafeRedirectPath", () => {
  it.each([
    "/invitations/accept/confirm",
    "/account",
    "/",
  ])("アプリ内の相対パス(%s)はそのまま許可する", (value) => {
    expect(toSafeRedirectPath(value)).toBe(value);
  });

  it.each([
    null,
    "",
    "evil.example.test",
    "//evil.example.test",
    "https://evil.example.test/",
    "javascript:alert(1)",
    "/\\evil.example.test",
  ])("外部ドメインやscheme-relative URL(%s)はnullとして拒否する", (value) => {
    expect(toSafeRedirectPath(value)).toBeNull();
  });

  it("File値はnullとして拒否する", () => {
    const file = new File(["contents"], "next.txt");
    expect(toSafeRedirectPath(file)).toBeNull();
  });
});
