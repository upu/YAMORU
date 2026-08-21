import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  acceptInvitationMock,
  cookiesMock,
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  acceptInvitationMock: vi.fn(),
  cookiesMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../lib/d1/invitations", () => ({
  acceptInvitationForExistingUser: acceptInvitationMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { acceptInvitationClaim } from "../app/invitations/accept/confirm/actions";

function cookieStore(claimSecret: string | undefined) {
  const deleteMock = vi.fn();
  return {
    deleteMock,
    store: {
      delete: deleteMock,
      get: vi.fn().mockReturnValue(
        claimSecret === undefined ? undefined : { value: claimSecret },
      ),
    },
  };
}

describe("既存利用者のD1招待受諾", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: { userId: "user-1" } });
  });

  it("claimなしはD1へ触れず共通エラーを返す", async () => {
    cookiesMock.mockResolvedValue(cookieStore(undefined).store);

    await expect(acceptInvitationClaim()).resolves.toEqual({ kind: "invalid", status: "error" });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });

  it("成功時はsession利用者として原子的に受諾しcookieを削除する", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);
    acceptInvitationMock.mockResolvedValue(true);

    await acceptInvitationClaim();

    expect(acceptInvitationMock).toHaveBeenCalledWith(
      "db",
      { userId: "user-1" },
      "claim-secret",
    );
    expect(deleteMock).toHaveBeenCalledWith({
      name: "yamoru_invite_claim",
      path: "/invitations/accept",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("無効・メール不一致・別家庭は共通エラーにしてcookieを使い切る", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);
    acceptInvitationMock.mockResolvedValue(false);

    await expect(acceptInvitationClaim()).resolves.toEqual({ kind: "invalid", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("予期しないD1エラーでは再試行用cookieを残す", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);
    acceptInvitationMock.mockRejectedValue(new Error("D1 unavailable"));

    await expect(acceptInvitationClaim()).rejects.toThrow("D1 unavailable");
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
