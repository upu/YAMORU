import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../app/managed-items/[id]/page";
import {
  ManagedItemsContent,
  type ManagedItemSummary,
} from "../app/managed-items/page";

afterEach(cleanup);

const REGISTERED_ITEM: ManagedItemSummary = {
  id: "item-1",
  kind: "pet_supplies",
  name: "猫の浄水器",
};

describe("家の台帳一覧", () => {
  it("家庭未所属の利用者には台帳を隠して家庭作成を案内する", () => {
    render(<ManagedItemsContent household={null} items={[]} />);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("家庭所属済みなら専門知識不要の登録フォームと空状態を表示する", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[]}
      />,
    );

    const form = screen.getByRole("region", { name: "管理対象を登録" });
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
    expect(screen.getByText("まだ管理対象はありません。")).toBeInTheDocument();
  });

  it("自家庭の登録済みManagedItemを詳細へのリンクとして表示する", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[REGISTERED_ITEM]}
      />,
    );

    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    expect(within(list).getByText("ペット用品")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
  });
});

describe("登録済みManagedItem詳細", () => {
  it("名前、種類、複数の安全な外部リンクを表示する", () => {
    const item: ManagedItemDetailData = {
      externalLinks: [
        { id: "link-1", url: "https://example.com/product" },
        { id: "link-2", url: "http://example.com/manual" },
      ],
      id: "item-1",
      kind: "pet_supplies",
      name: "猫の浄水器",
    };

    render(<ManagedItemDetailContent item={item} />);

    expect(screen.getByRole("heading", { name: "猫の浄水器" })).toBeInTheDocument();
    expect(screen.getByText("ペット用品")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /外部リンクを開く/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("外部リンクがない場合も明確に表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{ ...REGISTERED_ITEM, externalLinks: [] }}
      />,
    );

    expect(screen.getByText("外部リンクは登録されていません。")).toBeInTheDocument();
  });

  it("保存データが壊れていても危険なスキームをリンク表示しない", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          externalLinks: [{ id: "unsafe-link", url: "javascript:alert(1)" }],
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: /外部リンクを開く/ })).not.toBeInTheDocument();
    expect(screen.getByText("外部リンクは登録されていません。")).toBeInTheDocument();
  });
});
