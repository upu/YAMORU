import { describe, expect, it } from "vitest";

import { isPublicPath } from "../src/app/public-paths";

describe("共通UIを隠す公開画面の境界", () => {
  it.each([
    "/login",
    "/invitations/accept",
    "/invitations/accept/confirm",
    "/invitations/accept/resume",
  ])("公開画面 %s を判定する", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/account",
    "/login-help",
    "/invitations/acceptance",
    "/invitations/accepted",
  ])("似た名前を含む保護画面 %s は公開扱いしない", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});
