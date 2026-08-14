import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  createClientMock,
  createServiceRoleClientMock,
  getUserMock,
  redirectMock,
  revalidatePathMock,
  rpcMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceRoleClientMock: vi.fn(),
  getUserMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// requireUser() (lib/auth/current-user) はgetUser()の検証にanonキーの
// サーバークライアントを使う。RPC呼び出し自体はservice-roleクライアント
// (下のservice-roleモック)を経由するため、二つを別々にモックする。
vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("../lib/supabase/service-role", () => ({
  createServiceRoleClient: createServiceRoleClientMock,
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

const VERIFIED_USER = { email: "person@example.test", id: "user-1" };

describe("招待claim受諾操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock } });
    getUserMock.mockResolvedValue({ data: { user: VERIFIED_USER }, error: null });
    createServiceRoleClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("claim cookieがない場合はRPCを呼ばず共通エラーを返す", async () => {
    const { store } = cookieStore(undefined);
    cookiesMock.mockResolvedValue(store);

    const result = await acceptInvitationClaim();

    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("成功時はAuthで検証済みの利用者IDを渡してRPCを呼び、claim cookieを削除してホームへ移動する", async () => {
    const { deleteMock, getMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({
      data: [{ result_code: "success", household_id: "h1", membership_created: true }],
      error: null,
    });

    await acceptInvitationClaim();

    expect(getMock).toHaveBeenCalledWith("yamoru_invite_claim");
    expect(rpcMock).toHaveBeenCalledWith("accept_household_invitation_by_claim", {
      p_user_id: VERIFIED_USER.id,
      claim_secret: "claim-secret-value",
    });
    expect(deleteMock).toHaveBeenCalledWith({
      name: "yamoru_invite_claim",
      path: "/invitations/accept",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("一人一家庭制約違反(cross_household)は別のエラー種別を返し、cookieを削除する", async () => {
    const { deleteMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({
      data: [{ result_code: "cross_household", household_id: null, membership_created: null }],
      error: null,
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
      data: [{ result_code: "invalid", household_id: null, membership_created: null }],
      error: null,
    });

    const result = await acceptInvitationClaim();

    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Invitation token is invalid");
  });

  it("レート制限中(rate_limited相当)も共通エラーと区別できない結果を返す", async () => {
    const { deleteMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    // DB側はrate_limitedもinvalidとして返す(YDR-019: 区別できない応答)。
    rpcMock.mockResolvedValue({
      data: [{ result_code: "invalid", household_id: null, membership_created: null }],
      error: null,
    });

    const result = await acceptInvitationClaim();

    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
  });

  it("予期しないRPCエラーも共通エラーとして扱う", async () => {
    const { deleteMock, store } = cookieStore("claim-secret-value");
    cookiesMock.mockResolvedValue(store);
    rpcMock.mockResolvedValue({ data: null, error: new Error("unexpected failure") });

    const result = await acceptInvitationClaim();

    expect(result).toEqual({ kind: "invalid", status: "error" });
    expect(deleteMock).toHaveBeenCalled();
  });
});
