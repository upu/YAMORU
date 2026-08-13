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
  it("登録とログインをキーボードや支援技術から識別できる", async () => {
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

    const signup = screen.getByRole("region", { name: "新規登録" });
    expect(
      within(signup).getByRole("button", { name: "新規登録" }),
    ).toBeInTheDocument();
  });
});

describe("アカウント画面", () => {
  function overrideTypesResult<T>(data: T, error: unknown) {
    const result = Promise.resolve({ data, error });
    return Object.assign(result, {
      overrideTypes: () => result,
    });
  }

  function mockAccountQueries({
    household,
    profile,
  }: {
    household: { id: string; name: string } | null;
    profile: { nickname: string } | null;
  }) {
    const householdMaybeSingle = vi
      .fn()
      .mockReturnValue(overrideTypesResult(household, null));
    const limit = vi.fn().mockReturnValue({ maybeSingle: householdMaybeSingle });
    const order = vi.fn().mockReturnValue({ limit });
    const householdSelect = vi.fn().mockReturnValue({ order });

    const profileMaybeSingle = vi
      .fn()
      .mockReturnValue(overrideTypesResult(profile, null));
    const eq = vi.fn().mockReturnValue({ maybeSingle: profileMaybeSingle });
    const profileSelect = vi.fn().mockReturnValue({ eq });

    createClientMock.mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "households") return { select: householdSelect };
        if (table === "profiles") return { select: profileSelect };
        throw new Error(`unexpected table: ${table}`);
      }),
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

  it("家庭未所属だがニックネーム登録済みの利用者に、ニックネームを初期値とした家庭作成フォームを表示する", async () => {
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-id",
    });
    mockAccountQueries({ household: null, profile: { nickname: "たろう" } });

    render(await AccountPage());

    const householdSection = screen.getByRole("region", {
      name: "家庭を作成",
    });
    const householdInput = within(householdSection).getByLabelText("家庭名");
    expect(householdInput).toHaveAttribute("maxLength", "100");
    expect(householdInput).toHaveValue("たろうの家庭");
    expect(
      within(householdSection).getByRole("button", { name: "家庭を作成" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("ニックネーム")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
  });

  it("家庭所属済みの利用者には家庭名だけを表示し、作成フォームを隠す", async () => {
    requireUserMock.mockResolvedValue({
      email: "member@example.test",
      id: "member-id",
    });
    mockAccountQueries({
      household: { id: "household-id", name: "テスト家庭" },
      profile: { nickname: "はなこ" },
    });

    render(await AccountPage());

    expect(screen.getByRole("heading", { name: "所属している家庭" })).toBeInTheDocument();
    expect(screen.getByText("テスト家庭")).toBeInTheDocument();
    expect(screen.queryByLabelText("家庭名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ニックネーム")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "家庭を作成" }),
    ).not.toBeInTheDocument();
  });
});
