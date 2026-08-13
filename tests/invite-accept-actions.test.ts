import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, createClientMock, redirectMock, revalidatePathMock, rpcMock } =
  vi.hoisted(() => ({
    cookiesMock: vi.fn(),
    createClientMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    rpcMock: vi.fn(),
  }));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

import { acceptInvitationClaim } from "../app/invitations/accept/confirm/actions";

function cookieStore(claimSecret: string | undefined) {
  const deleteMock = vi.fn();
  const getMock = vi.fn().mockReturnValue(
    claimSecret === undefined ? undefined : { value: claimSecret },
  );
  return { deleteMock, getMock, store: { delete: deleteMock, get: getMock } };
}

describe("招待claim受諾操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
  });

  it("claim cookieがない場合はRPCを呼ばず共通エラーを返す", async () => {
    const { store } = cookieStore(undefined);
    cookiesMock.mockResolvedValue(store);

    const result = await acceptInvitationClaim();

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("成功時はclaim cookieを削除し、ホームへ移動する", async () => {
    const { deleteMock, getMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({ data: [{ household_id: "h1", membership_created: true }], error: null });

    await acceptInvitationClaim();

    expect(getMock).toHaveBeenCalledWith("yamoru_invite_claim");
    expect(rpcMock).toHaveBeenCalledWith("accept_household_invitation_by_claim", {
      claim_secret: "claim-secret-value",
    });
    expect(deleteMock).toHaveBeenCalledWith({
      name: "yamoru_invite_claim",
      path: "/invitations/accept",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("一人一家庭制約違反(P0002)は別のエラー種別を返し、cookieを削除する", async () => {
    const { deleteMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Already a member of a different household" },
    });

    const result = await acceptInvitationClaim();

    expect(result).toEqual({ kind: "cross-household", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("その他の失敗(共通エラー)は内部詳細を表示せず、cookieを削除する", async () => {
    const { deleteMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Invitation token is invalid, expired, or already used" },
    });

    const result = await acceptInvitationClaim();

    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Invitation token is invalid");
  });
});
