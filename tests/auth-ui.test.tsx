import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, requireUserMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../lib/auth/current-user", () => ({
  requireUser: requireUserMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import AccountPage from "../app/account/page";
import LoginPage from "../app/login/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ログイン画面", () => {
  it("登録とログインをキーボードや支援技術から識別できる", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "YAMORUへログイン" }),
    ).toBeInTheDocument();

    const login = screen.getByRole("region", { name: "ログイン" });
    expect(within(login).getByLabelText("メールアドレス")).toHaveAttribute(
      "type",
      "email",
    );
    expect(within(login).getByLabelText("パスワード")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      within(login).getByRole("button", { name: "ログイン" }),
    ).toBeInTheDocument();

    const signup = screen.getByRole("region", { name: "新規登録" });
    expect(
      within(signup).getByRole("button", { name: "新規登録" }),
    ).toBeInTheDocument();
  });
});

describe("アカウント画面", () => {
  function mockHouseholdResult(
    data: { id: string; name: string } | null,
  ) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    const limit = vi.fn().mockReturnValue({ maybeSingle });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    createClientMock.mockResolvedValue({
      from: vi.fn().mockReturnValue({ select }),
    });
  }

  it("家庭未所属の利用者に、支援技術から識別できる作成フォームを表示する", async () => {
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-id",
    });
    mockHouseholdResult(null);

    render(await AccountPage());

    expect(screen.getByText("person@example.test")).toBeInTheDocument();
    const householdSection = screen.getByRole("region", {
      name: "家庭を作成",
    });
    expect(within(householdSection).getByLabelText("家庭名")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(
      within(householdSection).getByRole("button", { name: "家庭を作成" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
  });

  it("家庭所属済みの利用者には家庭名だけを表示し、作成フォームを隠す", async () => {
    requireUserMock.mockResolvedValue({
      email: "member@example.test",
      id: "member-id",
    });
    mockHouseholdResult({ id: "household-id", name: "テスト家庭" });

    render(await AccountPage());

    expect(screen.getByRole("heading", { name: "所属している家庭" })).toBeInTheDocument();
    expect(screen.getByText("テスト家庭")).toBeInTheDocument();
    expect(screen.queryByLabelText("家庭名")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "家庭を作成" }),
    ).not.toBeInTheDocument();
  });
});
