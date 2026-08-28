import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import { ManagedItemForm } from "../src/app/managed-items/managed-item-form";
import { ManagedItemEditForm } from "../src/app/managed-items/[id]/edit/managed-item-edit-form";

afterEach(cleanup);

const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "appliance", kindCode: "asset", label: "家電" },
    { code: "contract", kindCode: "service", label: "契約" },
  ],
  kinds: [
    { code: "asset", label: "モノ" },
    { code: "service", label: "サービス" },
    { code: "obligation", label: "支払い・手続き" },
    { code: "other", label: "その他" },
  ],
};

describe("ManagedItemの分類入力(Issue #41)", () => {
  it("大分類を一つ選び、同じ大分類の詳しい種類だけを候補にする", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    const kind = screen.getByLabelText("大分類");
    const itemType = screen.getByLabelText("詳しい種類（任意）");
    expect(kind).toHaveValue("asset");
    expect(screen.getByRole("option", { name: "家電" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "契約" })).not.toBeInTheDocument();

    fireEvent.change(kind, { target: { value: "service" } });

    expect(itemType).toHaveValue("");
    expect(screen.getByRole("option", { name: "契約" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "家電" })).not.toBeInTheDocument();
  });

  it("プリセットにない詳しい種類を自由入力できる", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    fireEvent.change(screen.getByLabelText("詳しい種類（任意）"), {
      target: { value: "__custom__" },
    });

    expect(screen.getByLabelText("詳しい種類を入力")).toHaveAttribute(
      "maxLength",
      "50",
    );
  });

  it("編集画面では保存済みの自由入力を復元し、分類を変更し直せる", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType="猫用給水機"
        externalUrl={null}
        id="item-1"
        itemTypeCode={null}
        kindCode="asset"
        name="猫の給水機"
        note={null}
        productInfo={null}
        startedOn={null}
      />,
    );

    expect(screen.getByLabelText("大分類")).toHaveValue("asset");
    expect(screen.getByLabelText("詳しい種類（任意）")).toHaveValue("__custom__");
    expect(screen.getByLabelText("詳しい種類を入力")).toHaveValue("猫用給水機");
  });
});
