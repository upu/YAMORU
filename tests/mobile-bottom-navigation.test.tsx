import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { MobileBottomNavigation } from "../src/app/mobile-bottom-navigation";

afterEach(cleanup);

describe("モバイル下部ナビゲーション(Issue #146、#213、#350)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  // Issue #350 / YDR-042: 横断検索は日常的に使う到達手段なので、補助メニューの
  // 奥ではなく主要ナビゲーションの4項目目へ常設する。
  it("ホーム、Todo、台帳、検索をアイコンと短いラベル付きで表示する", () => {
    render(<MobileBottomNavigation />);

    const navigation = screen.getByRole("navigation", {
      name: "主要ナビゲーション",
    });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.textContent))
      .toEqual(["ホーム", "Todo", "台帳", "検索"]);
    expect(within(navigation).getByRole("link", { name: "ホーム" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(navigation).getByRole("link", { name: "Todo" })).toHaveAttribute(
      "href",
      "/todos",
    );
    expect(within(navigation).getByRole("link", { name: "台帳" })).toHaveAttribute(
      "href",
      "/managed-items?kind=asset",
    );
    expect(within(navigation).getByRole("link", { name: "検索" })).toHaveAttribute(
      "href",
      "/search",
    );
    expect(navigation.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });

  it("ホームではホームを現在地として示す", () => {
    render(<MobileBottomNavigation />);

    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Todo" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "台帳" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "検索" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each([
    "/managed-items",
    "/managed-items/new",
    "/managed-items/item-1",
    "/consumables",
    "/consumables/new",
    "/consumables/consumable-1",
  ])(
    "%sでは台帳を現在地として示す",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      render(<MobileBottomNavigation />);

      expect(screen.getByRole("link", { name: "台帳" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByRole("link", { name: "Todo" })).not.toHaveAttribute(
        "aria-current",
      );
      expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute(
        "aria-current",
      );
      expect(screen.getByRole("link", { name: "検索" })).not.toHaveAttribute(
        "aria-current",
      );
    },
  );

  it.each(["/todos", "/todos/new", "/todos/occurrence-1"])(
    "%sではTodoを現在地として示す",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      render(<MobileBottomNavigation />);

      expect(screen.getByRole("link", { name: "Todo" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute(
        "aria-current",
      );
      expect(screen.getByRole("link", { name: "台帳" })).not.toHaveAttribute(
        "aria-current",
      );
      expect(screen.getByRole("link", { name: "検索" })).not.toHaveAttribute(
        "aria-current",
      );
    },
  );

  it("/searchでは検索を現在地として示す", () => {
    usePathnameMock.mockReturnValue("/search");
    render(<MobileBottomNavigation />);

    expect(screen.getByRole("link", { name: "検索" })).toHaveAttribute(
      "aria-current",
      "page",
    );
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
