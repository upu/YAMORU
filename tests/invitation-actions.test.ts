import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelInvitationMock, getD1ContextMock, headersMock, issueInvitationMock, revalidatePathMock } = vi.hoisted(
  () => ({
    cancelInvitationMock: vi.fn(),
    getD1ContextMock: vi.fn(),
    headersMock: vi.fn(),
    issueInvitationMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock("../lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../lib/d1/invitations", () => ({
  cancelHouseholdInvitation: cancelInvitationMock,
  issueHouseholdInvitation: issueInvitationMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

import { cancelInvitation, issueInvitation } from "../app/household/invitation-actions";

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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    headersMock.mockResolvedValue(
      new Map([
        ["host", "yamoru.example.test"],
        ["x-forwarded-proto", "https"],
      ]),
    );
    issueInvitationMock.mockResolvedValue({
      expiresAt: "2026-08-21T00:00:00.000Z",
      invitedEmail: "family@example.test",
      invitationId: "invitation-1",
      token: "raw-token-value",
    });
  });

  it("招待先メールの前後空白を除き、限定RPCだけへ渡す", async () => {
    await issueInvitation(INITIAL_ISSUE_STATE, issueForm("  family@example.test  "));

    expect(issueInvitationMock).toHaveBeenCalledWith(
      "db",
      "session",
      "family@example.test",
    );
  });

  it("発行成功時は絶対URLの招待リンクを一度だけ返す(#140: 生tokenはfragmentに載せる)", async () => {
    const result = await issueInvitation(INITIAL_ISSUE_STATE, issueForm("family@example.test"));

    expect(result).toEqual({
      expiresAt: "2026-08-21T00:00:00.000Z",
      invitedEmail: "family@example.test",
      link: "https://yamoru.example.test/invitations/accept#token=raw-token-value",
      status: "issued",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/household");
  });

  it.each(["", "   ", "no-at-sign", "@leading-at.test", "trailing-at@"])(
    "無効な招待先メール(%s)はRPCへ送信しない",
    async (email) => {
      const result = await issueInvitation(INITIAL_ISSUE_STATE, issueForm(email));

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "招待先メールアドレスを正しく入力してください。",
        status: "error",
      });
    },
  );

  it("発行失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    issueInvitationMock.mockRejectedValue(new Error("sensitive database detail"));

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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    cancelInvitationMock.mockResolvedValue(undefined);
  });

  it("招待IDを限定RPCへ渡し、一覧を再検証する", async () => {
    const result = await cancelInvitation(INITIAL_CANCEL_STATE, cancelForm("invitation-1"));

    expect(cancelInvitationMock).toHaveBeenCalledWith(
      "db",
      "session",
      "invitation-1",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/household");
    expect(result).toEqual({ message: "", status: "idle" });
  });

  it("招待IDがない場合はRPCへ送信しない", async () => {
    const result = await cancelInvitation(INITIAL_CANCEL_STATE, new FormData());

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
  });

  it("取消失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    cancelInvitationMock.mockRejectedValue(new Error("sensitive database detail"));

    const result = await cancelInvitation(INITIAL_CANCEL_STATE, cancelForm("invitation-1"));

    expect(result).toEqual({
      message: "招待を取消できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
  });
});
