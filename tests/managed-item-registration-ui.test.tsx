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
    { code: "property_tax", kindCode: "service", label: "固定資産税" },
  ],
  kinds: [
    { code: "asset", label: "備品" },
    { code: "service", label: "サービス・契約" },
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
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  // Issue #393: 「ADD ITEM」「管理対象を登録」説明文「登録内容」と役割の重なる
  // 見出しが4つ並び、最初の入力欄までの縦幅を使っていた。
  it("キッカー・説明文・「登録内容」を画面に出さず、見出し一つに収める", () => {
    render(
      <ManagedItemRegistrationContent
        classificationOptions={CLASSIFICATION_OPTIONS}
        household={{ id: "household-1", name: "テスト家庭" }}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "管理対象を登録" }))
      .toBeInTheDocument();
    expect(screen.queryByText("ADD ITEM")).not.toBeInTheDocument();
    expect(screen.queryByText("家で管理するものと、確認に使う外部リンクを登録します。"))
      .not.toBeInTheDocument();
    // 入力領域の意味は支援技術向けに残す(画面には出さない)。
    const form = screen.getByRole("region", { name: "登録内容" });
    expect(within(form).getByRole("heading", { level: 2, name: "登録内容" }))
      .toHaveClass("sr-only");
    // どの家庭の台帳へ入るかは、共有の境界が分かる情報として残す。
    expect(within(form).getByText("テスト家庭の台帳へ追加します。")).toBeInTheDocument();
  });

  // Issue #393: 入力欄のラベルとplaceholderから分かる説明は繰り返さない。
  it("ラベルから分かる補足を削り、判断材料になる補足だけを残す", () => {
    render(
      <ManagedItemRegistrationContent
        classificationOptions={CLASSIFICATION_OPTIONS}
        household={{ id: "household-1", name: "テスト家庭" }}
      />,
    );

    expect(screen.queryByText(/家庭内でこの管理対象を見分けるための呼び名です。/u))
      .not.toBeInTheDocument();
    expect(screen.getByText("メーカー名や型番は下の「メーカー・商品名など」に書けます。"))
      .toBeInTheDocument();
    // 外部リンクはラベルとplaceholderで示し、補足文を置かない。
    expect(screen.getByLabelText("外部リンク（任意）"))
      .not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/httpまたはhttpsで始まるURL/u)).not.toBeInTheDocument();
    // メモは補足文をやめ、例をplaceholderで示す。
    expect(screen.queryByText(/置き場所や使い方など、家庭で残しておきたいこと/u))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("メモ（任意）"))
      .toHaveAttribute("placeholder", "例: 置き場所や使い方");
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
    expect(within(form).getByLabelText("名前")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(within(form).getByLabelText("大分類")).toHaveValue("asset");
    expect(within(form).getByRole("option", { name: "サービス・契約" }))
      .toBeInTheDocument();
    expect(within(form).queryByRole("option", { name: "支払い・手続き" }))
      .not.toBeInTheDocument();
    expect(within(form).getByLabelText("詳しい種類（任意）")).toHaveValue("");
    expect(within(form).getByRole("option", { name: "ペット用品" })).toBeInTheDocument();
    expect(within(form).queryByRole("option", { name: /^その他$/ }))
      .not.toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "その他（自由入力）" })).toBeInTheDocument();
    expect(within(form).getByLabelText("外部リンク（任意）")).toHaveAttribute(
      "type",
      "url",
    );
  });
});
