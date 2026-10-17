import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import { ManagedItemForm } from "../src/app/managed-items/managed-item-form";
import { ManagedItemEditForm } from "../src/app/managed-items/[id]/edit/managed-item-edit-form";

afterEach(cleanup);

const CLASSIFICATION_OPTIONS = {
  itemTypes: [{ code: "lesson", kindCode: "service", label: "習い事" }],
  kinds: [
    { code: "asset", label: "備品" },
    { code: "service", label: "サービス・契約" },
  ],
};

const TAG_OPTIONS = [
  { id: "tag-child", name: "子どもA" },
  { id: "tag-pet", name: "ペット" },
];

function tagGroup(): HTMLElement {
  return screen.getByRole("group", { name: "タグ（任意）" });
}

// Issue #226 / YDR-048: タグは大分類・詳しい種類とは別の欄で付け外しする。
describe("ManagedItemのタグ入力(Issue #226)", () => {
  it("登録フォームで家庭内の既存タグを選べ、新しいタグも書ける", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} tagOptions={TAG_OPTIONS} />);

    const group = tagGroup();
    const child = within(group).getByRole("checkbox", { name: "子どもA" });
    const pet = within(group).getByRole("checkbox", { name: "ペット" });
    expect(child).not.toBeChecked();
    expect(pet).not.toBeChecked();
    expect(child).toHaveAttribute("name", "tagIds");
    expect(child).toHaveAttribute("value", "tag-child");
    expect(within(group).getByLabelText("新しいタグ")).toHaveAttribute("name", "newTags");
    // 分類の入力はタグの欄に入らない。
    expect(within(group).queryByLabelText("大分類")).not.toBeInTheDocument();
    expect(within(group).queryByLabelText("詳しい種類（任意）")).not.toBeInTheDocument();
  });

  it("家庭にまだタグがなければ、新しいタグの入力だけを出す", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    const group = tagGroup();
    expect(within(group).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(group).getByLabelText("新しいタグ")).toHaveValue("");
  });

  it("編集フォームでは付与済みタグをチェック済みで表示し、外せる", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType={null}
        externalUrl={null}
        id="item-1"
        itemTypeCode="lesson"
        kindCode="service"
        name="○○デイ"
        note={null}
        productInfo={null}
        startedOn={null}
        tagIds={["tag-child"]}
        tagOptions={TAG_OPTIONS}
      />,
    );

    const group = tagGroup();
    expect(within(group).getByRole("checkbox", { name: "子どもA" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "ペット" })).not.toBeChecked();
    expect(screen.getByLabelText("大分類")).toHaveValue("service");
  });
});
