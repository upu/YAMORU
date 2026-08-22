import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cookiesMock, getD1DatabaseMock, openInvitationClaimMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getD1DatabaseMock: vi.fn(),
  openInvitationClaimMock: vi.fn(),
}));

vi.mock("../lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("../lib/d1/invitations", () => ({ openInvitationClaim: openInvitationClaimMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { openInvitationClaimAction } from "../app/invitations/accept/actions";

function cookieStore() {
  const setMock = vi.fn();
  return { setMock, store: { set: setMock } };
}

describe("招待token fragmentのD1 claim交換(#140)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1DatabaseMock.mockResolvedValue("db");
  });

  it("raw tokenをD1 claimへ交換し、request bodyだけで受け取ってHttpOnly cookieを設定する", async () => {
    const { setMock, store } = cookieStore();
    cookiesMock.mockResolvedValue(store);
    openInvitationClaimMock.mockResolvedValue({
      claimSecret: "a".repeat(64),
      expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    });

    await openInvitationClaimAction("raw-secret-token");

    expect(openInvitationClaimMock).toHaveBeenCalledWith("db", "raw-secret-token");
    expect(setMock).toHaveBeenCalledWith(
      "yamoru_invite_claim",
      "a".repeat(64),
      expect.objectContaining({
        httpOnly: true,
        path: "/invitations/accept",
        sameSite: "lax",
      }),
    );
    const options = setMock.mock.calls[0]?.[2] as { maxAge: number };
    expect(options.maxAge).toBeLessThanOrEqual(30 * 60);
  });

  it("空tokenはD1へ触れずcookieも設定しない", async () => {
    const { setMock, store } = cookieStore();
    cookiesMock.mockResolvedValue(store);

    await openInvitationClaimAction("");

    expect(getD1DatabaseMock).not.toHaveBeenCalled();
    expect(openInvitationClaimMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("無効tokenと内部エラーのどちらもcookieを設定しない", async () => {
    const { setMock, store } = cookieStore();
    cookiesMock.mockResolvedValue(store);
    openInvitationClaimMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("db"));

    await expect(openInvitationClaimAction("invalid")).resolves.toBeUndefined();
    await expect(openInvitationClaimAction("failure")).resolves.toBeUndefined();

    expect(setMock).not.toHaveBeenCalled();
  });
});
