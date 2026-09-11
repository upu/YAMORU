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
import { SidebarNavigation } from "../src/app/sidebar-navigation";

afterEach(cleanup);

function sidebar() {
  return screen.getByRole("navigation", { name: "主要ナビゲーション" });
}

// Issue #219: モバイル幅より広い画面には主要ナビゲーションが無かった。
// サイドバーを足すが、項目・行き先・現在地の意味は下部ナビゲーションと同じに
// する(見た目だけを画面幅で変える)。
describe("PCのサイドバーナビゲーション(Issue #219)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/");
  });

  it("ホーム、Todo、台帳、検索を同じ順・同じ行き先で表示する", () => {
    render(<SidebarNavigation />);

    const links = within(sidebar()).getAllByRole("link");
    expect(links.map((link) => link.textContent))
      .toEqual(["ホーム", "Todo", "台帳", "検索"]);
    expect(links.map((link) => link.getAttribute("href")))
      .toEqual(["/", "/todos", "/managed-items?kind=asset", "/search"]);
  });

  // 画面幅で見た目が変わっても、どの行き先へ進むかは変わらない。
  it("下部ナビゲーションと同じ項目・行き先を示す", () => {
    const { unmount } = render(<SidebarNavigation />);
    const sidebarLinks = within(sidebar()).getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    unmount();

    render(<MobileBottomNavigation />);
    const bottomLinks = within(sidebar()).getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);

    expect(sidebarLinks).toEqual(bottomLinks);
  });

  it.each([
    ["/", "ホーム"],
    ["/todos", "Todo"],
    ["/todos/occurrence-1", "Todo"],
    ["/managed-items", "台帳"],
    ["/managed-items/item-1", "台帳"],
    ["/consumables", "台帳"],
    ["/consumables/consumable-1", "台帳"],
    ["/search", "検索"],
  ])("%s では「%s」を現在地として支援技術へ伝える", (pathname, label) => {
    usePathnameMock.mockReturnValue(pathname);
    render(<SidebarNavigation />);

    const current = within(sidebar()).getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it("主要ナビゲーションのどれでもない画面では現在地を示さない", () => {
    usePathnameMock.mockReturnValue("/account");
    render(<SidebarNavigation />);

    expect(within(sidebar()).queryByRole("link", { current: "page" }))
      .not.toBeInTheDocument();
  });

  it.each(["/login", "/invitations/accept", "/invitations/accept/confirm"])(
    "公開画面 %s では表示しない",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      render(<SidebarNavigation />);

      expect(screen.queryByRole("navigation", { name: "主要ナビゲーション" }))
        .not.toBeInTheDocument();
    },
  );
});
