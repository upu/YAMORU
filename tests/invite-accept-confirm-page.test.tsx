import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  cookiesMock,
  getCurrentUserMock,
  getD1DatabaseMock,
  getInvitationClaimStateMock,
  redirectMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getD1DatabaseMock: vi.fn(),
  getInvitationClaimStateMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("../src/auth", () => ({ signIn: vi.fn() }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("../src/lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("../src/lib/d1/invitations", () => ({
  getInvitationClaimState: getInvitationClaimStateMock,
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import AcceptInvitationConfirmPage from "../src/app/invitations/accept/confirm/page";

function cookieStore(claimSecret?: string) {
  return { get: vi.fn().mockReturnValue(claimSecret === undefined ? undefined : { value: claimSecret }) };
}

describe("D1招待受諾確認画面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1DatabaseMock.mockResolvedValue("db");
    getCurrentUserMock.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("claimなし・無効claimは同じ共通エラーを表示する", async () => {
    cookiesMock.mockResolvedValueOnce(cookieStore());
    render(await AcceptInvitationConfirmPage());
    expect(screen.getByRole("heading", { name: "この招待は開けません" })).toBeInTheDocument();

    cleanup();
    cookiesMock.mockResolvedValueOnce(cookieStore("invalid-claim"));
    getInvitationClaimStateMock.mockResolvedValue(null);
    render(await AcceptInvitationConfirmPage());
    expect(screen.getByRole("heading", { name: "この招待は開けません" })).toBeInTheDocument();
  });

  it("未登録メールの有効claimでは招待限定登録フォームを表示する", async () => {
    cookiesMock.mockResolvedValue(cookieStore("claim-secret"));
    getInvitationClaimStateMock.mockResolvedValue({ email: "new@example.test", kind: "new" });

    render(await AcceptInvitationConfirmPage());

    expect(screen.getByRole("heading", { name: "招待からアカウントを作成" })).toBeInTheDocument();
    expect(screen.getByLabelText("メールアドレス")).toHaveValue("new@example.test");
    expect(screen.getByLabelText("ニックネーム")).toBeInTheDocument();
    expect(screen.getByLabelText("パスワード")).toHaveAttribute("minLength", "8");
    expect(screen.getByRole("button", { name: "アカウントを作成して参加" })).toBeInTheDocument();
  });

  it("既存メールの有効claimではログイン後に戻る", async () => {
    cookiesMock.mockResolvedValue(cookieStore("claim-secret"));
    getInvitationClaimStateMock.mockResolvedValue({ email: "existing@example.test", kind: "existing" });
    redirectMock.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });

    await expect(AcceptInvitationConfirmPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(
      "/login?next=%2Finvitations%2Faccept%2Fresume",
    );
  });

  it("ログイン済み利用者には受諾ボタンを表示し、commit時にメール一致を検証させる", async () => {
    cookiesMock.mockResolvedValue(cookieStore("claim-secret"));
    getInvitationClaimStateMock.mockResolvedValue({ email: "existing@example.test", kind: "existing" });
    getCurrentUserMock.mockResolvedValue({
      email: "existing@example.test",
      id: "existing-user",
      sessionVersion: 0,
    });

    render(await AcceptInvitationConfirmPage());

    expect(screen.getByRole("button", { name: "招待を受諾する" })).toBeInTheDocument();
  });
});
