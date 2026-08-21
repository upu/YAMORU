import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, getD1DatabaseMock, getUserForSessionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getD1DatabaseMock: vi.fn(),
  getUserForSessionMock: vi.fn(),
}));

vi.mock("../auth", () => ({ auth: authMock }));
vi.mock("../lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("../lib/d1/authentication", () => ({ getUserForSession: getUserForSessionMock }));

import { authConfig } from "../auth.config";
import { getCurrentUser } from "../lib/auth/current-user";

describe("Auth.js認証境界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1DatabaseMock.mockResolvedValue("db");
  });

  it.each([
    "/login",
    "/api/auth/session",
    "/invitations/accept",
    "/invitations/accept/confirm",
    "/manifest.webmanifest",
    "/icon.png",
  ])("公開経路 %s は未認証でも通す", async (pathname) => {
    await expect(Promise.resolve(authConfig.callbacks.authorized({
      auth: null,
      request: new NextRequest(`http://localhost${pathname}`),
    }))).resolves.toBe(true);
  });

  it("保護経路は署名済みJWT sessionがない要求を拒否する", async () => {
    await expect(Promise.resolve(authConfig.callbacks.authorized({
      auth: null,
      request: new NextRequest("http://localhost/account"),
    }))).resolves.toBe(false);
    await expect(Promise.resolve(authConfig.callbacks.authorized({
      auth: { expires: "2099-01-01", user: { id: "user-1", sessionVersion: 2 } },
      request: new NextRequest("http://localhost/account"),
    }))).resolves.toBe(true);
  });

  it("サーバー境界ではJWTのuserId/sessionVersionをD1と照合する", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 2 } });
    getUserForSessionMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-1",
      sessionVersion: 2,
    });

    await expect(getCurrentUser()).resolves.toEqual({
      email: "person@example.test",
      id: "user-1",
      sessionVersion: 2,
    });
    expect(getUserForSessionMock).toHaveBeenCalledWith("db", {
      sessionVersion: 2,
      userId: "user-1",
    });
  });

  it("古いsession_versionと壊れたJWTを未認証として扱う", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 1 } });
    getUserForSessionMock.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();

    authMock.mockResolvedValue({ user: { id: "user-1" } });
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("Cloudflare Workersの公開ホストを信頼し、preview/productionでUntrustedHostを起こさない(#137)", () => {
    expect(authConfig.trustHost).toBe(true);
  });
});
