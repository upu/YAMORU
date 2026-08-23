import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock, usePathnameMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
  usePathname: usePathnameMock,
}));

import { AppHeader } from "../app/app-header";
import { RefreshCoordinator } from "../app/refresh-coordinator";

afterEach(cleanup);

describe("認証済み画面の共通ヘッダー(Issue #147)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  function renderHeader() {
    return render(
      <RefreshCoordinator minimumPendingMs={0}>
        <AppHeader />
      </RefreshCoordinator>,
    );
  }

  it("YAMORUをホームへの共通導線として表示する", () => {
    renderHeader();

    const header = screen.getByRole("banner", { name: "共通ヘッダー" });
    expect(within(header).getByRole("link", { name: "YAMORU" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("右上の丸いボタンからアカウント・家庭・ログアウトを選べる", () => {
    renderHeader();

    const header = screen.getByRole("banner", { name: "共通ヘッダー" });
    const trigger = within(header).getByRole("button", { name: "アカウントメニュー" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const navigation = within(header).getByRole("navigation", {
      name: "アカウントメニュー",
    });
    expect(within(navigation).getByRole("link", { name: "アカウント" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(within(navigation).getByRole("link", { name: "家庭" })).toHaveAttribute(
      "href",
      "/household",
    );
    expect(within(navigation).getByRole("button", { name: "ログアウト" }))
      .toBeInTheDocument();
  });

  it("Escapeで閉じてトリガーへフォーカスを戻し、現在地を示す", () => {
    usePathnameMock.mockReturnValue("/account");
    renderHeader();

    const trigger = screen.getByRole("button", { name: "アカウントメニュー" });
    fireEvent.click(trigger);
    expect(screen.getByRole("link", { name: "アカウント" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "アカウントメニュー" }))
      .not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("外側を押すか項目を選ぶと閉じる", () => {
    renderHeader();

    const trigger = screen.getByRole("button", { name: "アカウントメニュー" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("navigation", { name: "アカウントメニュー" }))
      .not.toBeInTheDocument();

    fireEvent.click(trigger);
    const householdLink = screen.getByRole("link", { name: "家庭" });
    householdLink.addEventListener("click", (event) => {
      event.preventDefault();
    });
    fireEvent.click(householdLink);
    expect(screen.queryByRole("navigation", { name: "アカウントメニュー" }))
      .not.toBeInTheDocument();
  });

  it("ログアウト送信後は処理中表示にして連打を防ぐ", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "アカウントメニュー" }));
    const logoutButton = screen.getByRole("button", { name: "ログアウト" });

    const logoutForm = logoutButton.closest("form");
    if (logoutForm === null) throw new Error("ログアウトフォームがありません。");
    fireEvent.submit(logoutForm);

    expect(screen.getByRole("button", { name: "ログアウト中…" })).toBeDisabled();
  });

  it.each(["/login", "/invitations/accept", "/invitations/accept/confirm"])(
    "公開画面 %s では表示しない",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      renderHeader();

      expect(screen.queryByRole("banner", { name: "共通ヘッダー" }))
        .not.toBeInTheDocument();
    },
  );
});

describe("手動更新ボタン(Issue #149)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  it("共通ヘッダーに更新アイコンとアクセシブルネームを表示する", () => {
    render(
      <RefreshCoordinator minimumPendingMs={0}>
        <AppHeader />
      </RefreshCoordinator>,
    );

    const refreshButton = screen.getByRole("button", { name: "最新状態に更新" });
    expect(refreshButton).toBeEnabled();
    expect(refreshButton.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
