import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { AppFooter } from "../src/app/app-footer";
import { HelpContent } from "../src/app/help/page";

const VERSION_INFO = {
  buildId: "e174985",
  environment: "preview" as const,
  version: "0.8.0",
};

afterEach(cleanup);

describe("アプリバージョン表示(Issue #221)", () => {
  beforeEach(() => {
    usePathnameMock.mockReturnValue("/");
  });

  it("認証後の共通フッターには通常の版番号だけを表示する", () => {
    render(<AppFooter versionInfo={VERSION_INFO} />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent("YAMORU 0.8.0");
    expect(screen.getByRole("contentinfo")).not.toHaveTextContent("preview");
    expect(screen.getByRole("contentinfo")).not.toHaveTextContent("e174985");
  });

  it.each(["/login", "/invitations/accept/confirm"])(
    "公開画面 %s では共通フッターを表示しない",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      render(<AppFooter versionInfo={VERSION_INFO} />);

      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    },
  );

  it("ヘルプには環境と短いbuild識別子を含む一行表記を表示する", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    expect(screen.getByRole("heading", { name: "ヘルプ" })).toBeInTheDocument();
    expect(screen.getByText("YAMORU 0.8.0 · preview · e174985")).toBeInTheDocument();
    expect(screen.getByText("この一行をそのままお伝えください。")).toBeInTheDocument();
  });
});
