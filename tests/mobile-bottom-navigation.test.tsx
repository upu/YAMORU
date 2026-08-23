import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { MobileBottomNavigation } from "../app/mobile-bottom-navigation";

afterEach(cleanup);

describe("モバイル下部ナビゲーション(Issue #146)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  it("ホームと台帳だけを、アイコンと短いラベル付きで表示する", () => {
    render(<MobileBottomNavigation />);

    const navigation = screen.getByRole("navigation", {
      name: "主要ナビゲーション",
    });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(within(navigation).getByRole("link", { name: "ホーム" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(navigation).getByRole("link", { name: "台帳" })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    expect(navigation.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it("ホームではホームを現在地として示す", () => {
    render(<MobileBottomNavigation />);

    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "台帳" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("台帳一覧と詳細では台帳を現在地として示す", () => {
    usePathnameMock.mockReturnValue("/managed-items/item-1");
    render(<MobileBottomNavigation />);

    expect(screen.getByRole("link", { name: "台帳" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("Todo追加など主要2画面以外では選択状態を付けない", () => {
    usePathnameMock.mockReturnValue("/todos/new");
    render(<MobileBottomNavigation />);

    expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "台帳" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(["/login", "/invitations/accept", "/invitations/accept/confirm"])(
    "公開画面 %s では表示しない",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      render(<MobileBottomNavigation />);

      expect(
        screen.queryByRole("navigation", { name: "主要ナビゲーション" }),
      ).not.toBeInTheDocument();
    },
  );
});
