import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));

vi.mock("../lib/auth/current-user", () => ({
  requireUser: requireUserMock,
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
  it("検証済み利用者と、家庭所属とは別の認証状態を表示する", async () => {
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-id",
    });

    render(await AccountPage());

    expect(screen.getByText("person@example.test")).toBeInTheDocument();
    expect(screen.getByText("家庭はまだ設定されていません")).toBeInTheDocument();
    expect(
      screen.getByText("ログイン済みであることと、家庭への所属は別に確認します。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
  });
});
