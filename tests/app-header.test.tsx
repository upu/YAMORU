import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { AppHeader } from "../app/app-header";

afterEach(cleanup);

describe("認証済み画面の共通ヘッダー(Issue #147)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  it("右上の丸いボタンからアカウント・家庭・ログアウトを選べる", () => {
    render(<AppHeader />);

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
    render(<AppHeader />);

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
    render(<AppHeader />);

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
    render(<AppHeader />);
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
      render(<AppHeader />);

      expect(screen.queryByRole("banner", { name: "共通ヘッダー" }))
        .not.toBeInTheDocument();
    },
  );
});
