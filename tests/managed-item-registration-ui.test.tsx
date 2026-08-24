import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import { ManagedItemRegistrationContent } from "../src/app/managed-items/new/page";

afterEach(cleanup);

const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "pet_supplies", kindCode: "asset", label: "ペット用品" },
    { code: "contract", kindCode: "service", label: "契約" },
  ],
  kinds: [
    { code: "asset", label: "モノ" },
    { code: "service", label: "サービス" },
  ],
};

describe("管理対象登録", () => {
  it("家庭未所属なら登録フォームを隠して家庭作成を案内する", () => {
    render(
      <ManagedItemRegistrationContent
        classificationOptions={CLASSIFICATION_OPTIONS}
        household={null}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("台帳での名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("台帳へ戻れる専用ページで既存の入力項目を表示する", () => {
    render(
      <ManagedItemRegistrationContent
        classificationOptions={CLASSIFICATION_OPTIONS}
        household={{ id: "household-1", name: "テスト家庭" }}
      />,
    );

    expect(screen.getByRole("link", { name: /家の台帳へ戻る/ })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    const form = screen.getByRole("region", { name: "登録内容" });
    expect(within(form).getByLabelText("台帳での名前")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(within(form).getByLabelText("大分類")).toHaveValue("asset");
    expect(within(form).getByLabelText("詳しい種類（任意）")).toHaveValue("");
    expect(within(form).getByRole("option", { name: "ペット用品" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "その他（自由入力）" })).toBeInTheDocument();
    expect(within(form).getByLabelText("外部リンク（任意）")).toHaveAttribute(
      "type",
      "url",
    );
  });
});
