import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, createClientMock, getCurrentUserMock, redirectMock } = vi.hoisted(
  () => ({
    cookiesMock: vi.fn(),
    createClientMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    redirectMock: vi.fn(),
  }),
);

vi.mock("../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import AcceptInvitationConfirmPage from "../app/invitations/accept/confirm/page";

function cookieStoreWithClaim(hasClaim: boolean) {
  return {
    get: vi.fn().mockReturnValue(hasClaim ? { value: "claim-secret" } : undefined),
  };
}

function mockProfileQuery(profile: { nickname: string } | null) {
  const overrideTypesResult = Object.assign(
    Promise.resolve({ data: profile, error: null }),
    { overrideTypes: () => Promise.resolve({ data: profile, error: null }) },
  );
  const maybeSingle = vi.fn().mockReturnValue(overrideTypesResult);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  createClientMock.mockResolvedValue({ from: vi.fn().mockReturnValue({ select }) });
}

describe("招待受諾確認画面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("claim cookieがない場合は共通エラーを表示し、認証状態を確認しない", async () => {
    cookiesMock.mockResolvedValue(cookieStoreWithClaim(false));

    render(await AcceptInvitationConfirmPage());

    expect(
      screen.getByRole("heading", { name: "この招待は開けません" }),
    ).toBeInTheDocument();
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it("未ログインの場合は招待受諾画面へ戻るnext付きでログイン画面へリダイレクトする", async () => {
    cookiesMock.mockResolvedValue(cookieStoreWithClaim(true));
    getCurrentUserMock.mockResolvedValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(AcceptInvitationConfirmPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith(
      "/login?next=%2Finvitations%2Faccept%2Fconfirm",
    );
  });

  it("ニックネーム未登録の場合は受諾ボタンの代わりにニックネーム登録フォームを表示する", async () => {
    cookiesMock.mockResolvedValue(cookieStoreWithClaim(true));
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    mockProfileQuery(null);

    render(await AcceptInvitationConfirmPage());

    expect(
      screen.getByRole("heading", { name: "ニックネーム登録" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "招待を受諾する" }),
    ).not.toBeInTheDocument();
  });

  it("ニックネーム登録済みの場合は受諾ボタンを表示する", async () => {
    cookiesMock.mockResolvedValue(cookieStoreWithClaim(true));
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    mockProfileQuery({ nickname: "たろう" });

    render(await AcceptInvitationConfirmPage());

    expect(
      screen.getByRole("button", { name: "招待を受諾する" }),
    ).toBeInTheDocument();
  });
});
