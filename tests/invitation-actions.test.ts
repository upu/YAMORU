import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, headersMock, revalidatePathMock, rpcMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    headersMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    rpcMock: vi.fn(),
  }),
);

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

import { cancelInvitation, issueInvitation } from "../app/account/invitations/actions";

const INITIAL_ISSUE_STATE = { status: "idle" } as const;
const INITIAL_CANCEL_STATE = { message: "", status: "idle" } as const;

function issueForm(email: string) {
  const formData = new FormData();
  formData.set("invitedEmail", email);
  return formData;
}

function cancelForm(invitationId: string) {
  const formData = new FormData();
  formData.set("invitationId", invitationId);
  return formData;
}

describe("招待発行操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    headersMock.mockResolvedValue(
      new Map([
        ["host", "yamoru.example.test"],
        ["x-forwarded-proto", "https"],
      ]),
    );
    rpcMock.mockResolvedValue({
      data: [
        {
          expires_at: "2026-08-21T00:00:00.000Z",
          invitation_email: "family@example.test",
          invitation_id: "invitation-1",
          token: "raw-token-value",
        },
      ],
      error: null,
    });
  });

  it("招待先メールの前後空白を除き、限定RPCだけへ渡す", async () => {
    await issueInvitation(INITIAL_ISSUE_STATE, issueForm("  family@example.test  "));

    expect(rpcMock).toHaveBeenCalledWith("issue_household_invitation", {
      invited_email: "family@example.test",
    });
  });

  it("発行成功時は絶対URLの招待リンクを一度だけ返す", async () => {
    const result = await issueInvitation(INITIAL_ISSUE_STATE, issueForm("family@example.test"));

    expect(result).toEqual({
      expiresAt: "2026-08-21T00:00:00.000Z",
      invitedEmail: "family@example.test",
      link: "https://yamoru.example.test/invitations/accept?token=raw-token-value",
      status: "issued",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/account/invitations");
  });

  it.each(["", "   ", "no-at-sign", "@leading-at.test", "trailing-at@"])(
    "無効な招待先メール(%s)はRPCへ送信しない",
    async (email) => {
      const result = await issueInvitation(INITIAL_ISSUE_STATE, issueForm(email));

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "招待先メールアドレスを正しく入力してください。",
        status: "error",
      });
    },
  );

  it("発行失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await issueInvitation(INITIAL_ISSUE_STATE, issueForm("family@example.test"));

    expect(result).toEqual({
      message: "招待を発行できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(JSON.stringify(result)).not.toContain("sensitive database detail");
  });
});

describe("招待取消操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("招待IDを限定RPCへ渡し、一覧を再検証する", async () => {
    const result = await cancelInvitation(INITIAL_CANCEL_STATE, cancelForm("invitation-1"));

    expect(rpcMock).toHaveBeenCalledWith("cancel_household_invitation", {
      invitation_id: "invitation-1",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/account/invitations");
    expect(result).toEqual({ message: "", status: "idle" });
  });

  it("招待IDがない場合はRPCへ送信しない", async () => {
    const result = await cancelInvitation(INITIAL_CANCEL_STATE, new FormData());

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
  });

  it("取消失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await cancelInvitation(INITIAL_CANCEL_STATE, cancelForm("invitation-1"));

    expect(result).toEqual({
      message: "招待を取消できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
  });
});
