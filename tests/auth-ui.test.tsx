import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, loadAccountStateMock, requireUserMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({
  requireUser: requireUserMock,
}));

vi.mock("../src/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({
  getD1Context: getD1ContextMock,
}));

vi.mock("../src/lib/d1/households", () => ({
  loadAccountState: loadAccountStateMock,
}));

import AccountPage from "../src/app/account/page";
import LoginPage from "../src/app/login/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ログイン画面", () => {
  it("公開登録を表示せず、ログインだけをキーボードや支援技術から識別できる", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

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

    expect(screen.queryByRole("region", { name: "新規登録" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新規登録" })).not.toBeInTheDocument();
  });

  it("パスワード変更後は再ログインが必要だと案内する", async () => {
    render(await LoginPage({
      searchParams: Promise.resolve({ passwordChanged: "1" }),
    }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "パスワードを変更しました。新しいパスワードでログインしてください。",
    );
  });
});

describe("アカウント画面", () => {
  function mockAccountQueries({
    household,
    profile,
  }: {
    household: { id: string; name: string } | null;
    profile: { nickname: string } | null;
  }) {
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    loadAccountStateMock.mockResolvedValue({
      household,
      nickname: profile?.nickname ?? null,
    });
  }

  it("家庭未所属かつニックネーム未登録の利用者に、支援技術から識別できるニックネーム登録フォームを表示する", async () => {
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-id",
    });
    mockAccountQueries({ household: null, profile: null });

    render(await AccountPage());

    expect(screen.getByText("person@example.test")).toBeInTheDocument();
    const nicknameSection = screen.getByRole("region", {
      name: "ニックネーム登録",
    });
    expect(within(nicknameSection).getByLabelText("ニックネーム")).toHaveAttribute(
      "maxLength",
      "20",
    );
    expect(
      within(nicknameSection).getByRole("button", { name: "ニックネームを登録" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("家庭名")).not.toBeInTheDocument();
  });

  it("ニックネーム登録済みの利用者には個人情報だけを表示し、家庭管理とログアウトを置かない", async () => {
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-id",
    });
    mockAccountQueries({ household: null, profile: { nickname: "たろう" } });

    render(await AccountPage());

    const nicknameSection = screen.getByRole("region", { name: "ニックネーム" });
    expect(within(nicknameSection).getByText("たろう")).toBeInTheDocument();
    expect(
      within(nicknameSection).getByRole("button", { name: "編集" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ニックネームを登録" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("家庭名")).not.toBeInTheDocument();
    expect(screen.queryByText("所属している家庭")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ログアウト" }))
      .not.toBeInTheDocument();
  });

  it("パスワード変更フォームは利用者が開いたときだけ表示する", async () => {
    requireUserMock.mockResolvedValue({
      email: "member@example.test",
      id: "member-id",
    });
    mockAccountQueries({
      household: { id: "household-id", name: "テスト家庭" },
      profile: { nickname: "はなこ" },
    });

    render(await AccountPage());

    expect(screen.queryByLabelText("現在のパスワード")).not.toBeInTheDocument();
    const passwordSection = screen.getByRole("region", { name: "パスワード変更" });
    fireEvent.click(
      within(passwordSection).getByRole("button", { name: "パスワードを変更" }),
    );
    expect(within(passwordSection).getByLabelText("現在のパスワード")).toHaveAttribute(
      "type",
      "password",
    );
    expect(within(passwordSection).getByLabelText("新しいパスワード")).toHaveAttribute(
      "minLength",
      "8",
    );
    expect(within(passwordSection).getByRole("button", { name: "パスワードを変更" }))
      .toBeInTheDocument();
    expect(screen.queryByText("テスト家庭")).not.toBeInTheDocument();
  });

  it("「編集」を押すと現在のニックネームを初期値とした編集フォームへ切り替わり、「キャンセル」で表示へ戻る(Issue #76)", async () => {
    requireUserMock.mockResolvedValue({
      email: "member@example.test",
      id: "member-id",
    });
    mockAccountQueries({
      household: { id: "household-id", name: "テスト家庭" },
      profile: { nickname: "はなこ" },
    });

    render(await AccountPage());

    const nicknameSection = screen.getByRole("region", { name: "ニックネーム" });
    fireEvent.click(within(nicknameSection).getByRole("button", { name: "編集" }));

    const nicknameInput = within(nicknameSection).getByLabelText("ニックネーム");
    expect(nicknameInput).toHaveValue("はなこ");
    expect(nicknameInput).toHaveAttribute("maxLength", "20");
    expect(
      within(nicknameSection).getByRole("button", { name: "変更を保存" }),
    ).toBeInTheDocument();

    fireEvent.click(within(nicknameSection).getByRole("button", { name: "キャンセル" }));

    expect(within(nicknameSection).getByText("はなこ")).toBeInTheDocument();
    expect(
      within(nicknameSection).queryByLabelText("ニックネーム"),
    ).not.toBeInTheDocument();
  });
});
