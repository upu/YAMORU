import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getD1DatabaseMock, openInvitationClaimMock } = vi.hoisted(() => ({
  getD1DatabaseMock: vi.fn(),
  openInvitationClaimMock: vi.fn(),
}));

vi.mock("../lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("../lib/d1/invitations", () => ({ openInvitationClaim: openInvitationClaimMock }));

import { NextRequest } from "next/server";

import { GET } from "../app/invitations/accept/route";

describe("招待リンクのD1 claim交換", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1DatabaseMock.mockResolvedValue("db");
  });

  it("raw tokenをD1 claimへ交換し、HttpOnly cookieを設定してURLから除く", async () => {
    openInvitationClaimMock.mockResolvedValue({
      claimSecret: "a".repeat(64),
      expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    });

    const response = await GET(
      new NextRequest("http://localhost/invitations/accept?token=raw-secret-token"),
    );

    expect(openInvitationClaimMock).toHaveBeenCalledWith("db", "raw-secret-token");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/invitations/accept/confirm",
    );
    const cookie = response.cookies.get("yamoru_invite_claim");
    expect(cookie?.value).toBe("a".repeat(64));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/invitations/accept");
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge as number).toBeLessThanOrEqual(30 * 60);
  });

  it("tokenなしはD1へ触れず既存cookieを引き継ぐ", async () => {
    const response = await GET(new NextRequest("http://localhost/invitations/accept"));

    expect(getD1DatabaseMock).not.toHaveBeenCalled();
    expect(openInvitationClaimMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });

  it("無効tokenと内部エラーのどちらもcookieを設定せず同じ画面へ進む", async () => {
    openInvitationClaimMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("db"));

    const invalid = await GET(
      new NextRequest("http://localhost/invitations/accept?token=invalid"),
    );
    const failure = await GET(
      new NextRequest("http://localhost/invitations/accept?token=failure"),
    );

    expect(invalid.status).toBe(303);
    expect(failure.status).toBe(303);
    expect(invalid.cookies.get("yamoru_invite_claim")).toBeUndefined();
    expect(failure.cookies.get("yamoru_invite_claim")).toBeUndefined();
  });
});
