import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createServerClientMock, getClaimsMock, getUserMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    createServerClientMock: vi.fn(),
    getClaimsMock: vi.fn(),
    getUserMock: vi.fn(),
  }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { getCurrentUser } from "../lib/auth/current-user";
import { getSupabasePublicEnv } from "../lib/supabase/env";
import { updateSession } from "../lib/supabase/proxy";

describe("Supabase認証境界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-public-key";
    getClaimsMock.mockResolvedValue({
      data: { claims: { email: "person@example.test", sub: "user-id" } },
      error: null,
    });
    createServerClientMock.mockReturnValue({
      auth: { getClaims: getClaimsMock },
    });
  });

  it("公開可能なURLとキーだけを環境変数から読む", () => {
    const env = getSupabasePublicEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-be-returned",
    });

    expect(env).toEqual({
      publishableKey: "publishable",
      url: "http://127.0.0.1:54321",
    });
    expect(JSON.stringify(env)).not.toContain("must-not-be-returned");
  });

  it("必須の公開環境変数がない場合は明確に失敗する", () => {
    expect(() => getSupabasePublicEnv({})).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("未認証の利用者をログイン画面へ案内する", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    const response = await updateSession(new NextRequest("http://localhost/"));

    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(getClaimsMock).toHaveBeenCalledOnce();
  });

  it("招待入口と確認画面は未認証でも各Route・Pageの認証フローへ進める", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    const entryResponse = await updateSession(
      new NextRequest("http://localhost/invitations/accept?token=secret"),
    );
    const confirmResponse = await updateSession(
      new NextRequest("http://localhost/invitations/accept/confirm"),
    );

    expect(entryResponse.headers.get("location")).toBeNull();
    expect(confirmResponse.headers.get("location")).toBeNull();
  });

  it("ログイン画面は未認証でも表示できる", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });

    const response = await updateSession(
      new NextRequest("http://localhost/login"),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("認証済みの利用者は保護対象画面を表示できる", async () => {
    const response = await updateSession(new NextRequest("http://localhost/"));

    expect(response.headers.get("location")).toBeNull();
    expect(getClaimsMock).toHaveBeenCalledOnce();
  });

  it("サーバー側の現在利用者はAuthサーバーで検証する", async () => {
    const verifiedUser = { email: "person@example.test", id: "user-id" };
    getUserMock.mockResolvedValue({
      data: { user: verifiedUser },
      error: null,
    });
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock } });

    await expect(getCurrentUser()).resolves.toEqual(verifiedUser);
    expect(getUserMock).toHaveBeenCalledOnce();
  });

  it("Authサーバーで検証できないCookieは未認証として扱う", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid token"),
    });
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock } });

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
