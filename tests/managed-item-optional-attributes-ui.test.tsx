import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../src/app/managed-items/[id]/page";
import { ManagedItemEditForm } from "../src/app/managed-items/[id]/edit/managed-item-edit-form";
import { ManagedItemForm } from "../src/app/managed-items/managed-item-form";

afterEach(cleanup);

const CLASSIFICATION_OPTIONS = {
  itemTypes: [{ code: "appliance", kindCode: "asset", label: "家電" }],
  kinds: [{ code: "asset", label: "モノ" }],
};

const DETAIL_BASE: ManagedItemDetailData = {
  actorName: "家族A",
  currentUserId: "user-1",
  externalLinks: [],
  id: "item-1",
  itemTypeLabel: "家電",
  kindLabel: "モノ",
  lastActivity: null,
  members: [],
  name: "リビングのエアコン",
  note: null,
  pendingTodos: [],
  productInfo: null,
  purchasedOn: null,
  recentCompletions: [],
};

describe("ManagedItemの任意の記録(Issue #42)", () => {
  it("登録画面で台帳での名前と商品情報を別の欄として案内する", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    expect(screen.getByLabelText("台帳での名前")).toBeRequired();
    expect(
      screen.getByText("家庭内でこの管理対象を見分けるための呼び名です。"),
    ).toBeInTheDocument();

    const productInfo = screen.getByLabelText("メーカー・商品名など（任意）");
    expect(productInfo).not.toBeRequired();
    expect(screen.getByText(/メーカー名、商品名、型番など/u)).toBeInTheDocument();

    // 型番だけを独立した必須項目にしない。
    expect(screen.queryByLabelText("型番")).not.toBeInTheDocument();
    expect(screen.getByLabelText("メモ（任意）")).not.toBeRequired();
  });

  it("購入時期は年・月・日を分け、月日をわからないまま残せる", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    expect(screen.getByRole("group", { name: "購入時期（任意）" })).toBeInTheDocument();
    expect(screen.getByLabelText("年")).toHaveValue("");
    // 既定は「わからない」で、推測入力を強制しない。
    expect(screen.getByLabelText("月")).toHaveValue("");
    expect(screen.getByLabelText("日")).toHaveValue("");
  });

  it("編集画面へ保存済みの記録を精度どおり復元する", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType={null}
        externalUrl={null}
        id="item-1"
        itemTypeCode="appliance"
        kindCode="asset"
        name="リビングのエアコン"
        note={"窓側に設置。\nリモコンは棚の中。"}
        productInfo="三菱 霧ヶ峰 MSZ-ZW2224S"
        purchasedOn="2024-05"
      />,
    );

    expect(screen.getByLabelText("メーカー・商品名など（任意）"))
      .toHaveValue("三菱 霧ヶ峰 MSZ-ZW2224S");
    expect(screen.getByLabelText("メモ（任意）"))
      .toHaveValue("窓側に設置。\nリモコンは棚の中。");
    expect(screen.getByLabelText("年")).toHaveValue("2024");
    expect(screen.getByLabelText("月")).toHaveValue("05");
    // 日は保存していないため、わからないまま。
    expect(screen.getByLabelText("日")).toHaveValue("");
  });

  it("詳細画面で残した記録だけを名称と値の対として表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...DETAIL_BASE,
          note: "窓側に設置。",
          productInfo: "三菱 霧ヶ峰 MSZ-ZW2224S",
          purchasedOn: "2024-05",
        }}
      />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(record).toHaveTextContent("メーカー・商品名など");
    expect(record).toHaveTextContent("三菱 霧ヶ峰 MSZ-ZW2224S");
    expect(record).toHaveTextContent("購入時期");
    expect(record).toHaveTextContent("2024年5月");
    expect(record).toHaveTextContent("メモ");
    expect(record).toHaveTextContent("窓側に設置。");
  });

  it("年しか分からない購入時期を「ごろ」として表示する", () => {
    render(
      <ManagedItemDetailContent item={{ ...DETAIL_BASE, purchasedOn: "2024" }} />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(record).toHaveTextContent("2024年ごろ");
    // 残していない項目は表示しない。
    expect(record).not.toHaveTextContent("メモ");
    expect(record).not.toHaveTextContent("メーカー・商品名など");
  });

  it("記録が一つもない既存の管理対象では記録欄自体を表示しない", () => {
    render(<ManagedItemDetailContent item={DETAIL_BASE} />);

    expect(
      screen.queryByRole("region", { name: "この管理対象の記録" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "リビングのエアコン" }),
    ).toBeInTheDocument();
  });
});
