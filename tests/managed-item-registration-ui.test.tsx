import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({ auth: vi.fn() }));

import { ManagedItemRegistrationContent } from "../app/managed-items/new/page";

afterEach(cleanup);

describe("管理対象登録", () => {
  it("家庭未所属なら登録フォームを隠して家庭作成を案内する", () => {
    render(<ManagedItemRegistrationContent household={null} />);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("台帳へ戻れる専用ページで既存の入力項目を表示する", () => {
    render(
      <ManagedItemRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
      />,
    );

    expect(screen.getByRole("link", { name: /家の台帳へ戻る/ })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    const form = screen.getByRole("region", { name: "登録内容" });
    expect(within(form).getByLabelText("名前")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(within(form).getByLabelText("種類")).toHaveValue("pet_supplies");
    expect(within(form).getByRole("option", { name: "ペット用品" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "その他" })).toBeInTheDocument();
    expect(within(form).getByLabelText("外部リンク（任意）")).toHaveAttribute(
      "type",
      "url",
    );
  });
});
