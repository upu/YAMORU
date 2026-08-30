import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  kinds: [
    { code: "asset", label: "備品" },
    { code: "service", label: "サービス" },
    { code: "obligation", label: "支払い・手続き" },
  ],
};

const DETAIL_BASE: ManagedItemDetailData = {
  actorName: "家族A",
  currentUserId: "user-1",
  externalLinks: [],
  id: "item-1",
  itemTypeLabel: "家電",
  kindCode: "asset",
  kindLabel: "備品",
  members: [],
  name: "リビングのエアコン",
  note: null,
  pendingTodos: [],
  productInfo: null,
  recentCompletions: [],
  startedOn: null,
};

describe("ManagedItemの任意の記録(Issue #42)", () => {
  it("登録画面で名前と商品情報を別の欄として案内する", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    // ラベルは「名前」のまま。商品情報との違いは補足文で伝える。
    expect(screen.getByLabelText("名前")).toBeRequired();
    expect(screen.getByText(/家庭内でこの管理対象を見分けるための呼び名です。/u))
      .toHaveTextContent("メーカー名や型番は下の欄に書けます。");

    const productInfo = screen.getByLabelText("メーカー・商品名など（任意）");
    expect(productInfo).not.toBeRequired();
    expect(screen.getByText(/メーカー名、商品名、型番など/u)).toBeInTheDocument();

    // 型番だけを独立した必須項目にしない。
    expect(screen.queryByLabelText("型番")).not.toBeInTheDocument();
    expect(screen.getByLabelText("メモ（任意）")).not.toBeRequired();
  });

  it("開始時期は年・月・日を分け、月日をわからないまま残せる", () => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    // 既定の大分類は「備品」のため、見出し語は「購入時期」になる。
    expect(screen.getByRole("group", { name: "購入時期（任意）" })).toBeInTheDocument();
    expect(screen.getByLabelText("年")).toHaveValue("");
    // 既定は「わからない」で、推測入力を強制しない。
    expect(screen.getByLabelText("月")).toHaveValue("");
    expect(screen.getByLabelText("日")).toHaveValue("");
  });

  // Issue #287: 年欄のplaceholderは固定の「2024」ではなく、その時点の
  // 現在年を例として示す。値そのものは自動入力せず空のまま。
  it("年欄のplaceholderに現在年の例を表示する", () => {
    render(
      <ManagedItemForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        nowIso="2026-08-30T12:00:00Z"
      />,
    );

    expect(screen.getByLabelText("年")).toHaveValue("");
    expect(screen.getByLabelText("年")).toHaveAttribute("placeholder", "例: 2026");
  });

  // Issue #287: Server ComponentがUTCで実行されても、Asia/Tokyoの暦日で
  // 年をまたいだ現在年を示す(UTC 12/31 15:00 = JST 1/1 0:00)。
  it("UTCでは年内でもAsia/Tokyo基準で年が変わっていれば新しい年を例に表示する", () => {
    render(
      <ManagedItemForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        nowIso="2025-12-31T15:30:00Z"
      />,
    );

    expect(screen.getByLabelText("年")).toHaveAttribute("placeholder", "例: 2026");
  });

  // Issue #287: 編集画面では保存済みの値を優先して表示し、placeholderの
  // 現在年で上書きしない。
  it("編集画面ではplaceholderが現在年でも保存済みの値をそのまま表示する", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType={null}
        externalUrl={null}
        id="item-1"
        itemTypeCode="appliance"
        kindCode="asset"
        name="リビングのエアコン"
        note={null}
        nowIso="2026-08-30T12:00:00Z"
        productInfo={null}
        startedOn="2019"
      />,
    );

    expect(screen.getByLabelText("年")).toHaveValue("2019");
    expect(screen.getByLabelText("年")).toHaveAttribute("placeholder", "例: 2026");
  });

  // Issue #239: 保存する値の意味(対象との関係が始まった時期)は大分類に
  // よらず同じだが、見出し語は対象に合う自然な言葉へ切り替える(YDR-033)。
  it.each([
    ["service", "利用・契約を始めた時期"],
    ["obligation", "開始時期"],
  ])("大分類「%s」を選ぶと見出し語が「%s」に切り替わる", (kindCode, label) => {
    render(<ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />);

    fireEvent.change(screen.getByLabelText("大分類"), { target: { value: kindCode } });

    expect(screen.getByRole("group", { name: `${label}（任意）` })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "購入時期（任意）" })).not.toBeInTheDocument();
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
        startedOn="2024-05"
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

  // Issue #239: 編集画面でも大分類を変更すると見出し語が切り替わるが、
  // 入力済みの年月日はそのまま残る(値の意味を再解釈しない、YDR-033)。
  it("編集画面で大分類を変更すると見出し語は切り替わるが、入力済みの値は保たれる", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType={null}
        externalUrl={null}
        id="item-1"
        itemTypeCode="appliance"
        kindCode="asset"
        name="リビングのエアコン"
        note={null}
        productInfo={null}
        startedOn="2024-05"
      />,
    );

    fireEvent.change(screen.getByLabelText("大分類"), { target: { value: "service" } });

    expect(screen.getByRole("group", { name: "利用・契約を始めた時期（任意）" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("年")).toHaveValue("2024");
    expect(screen.getByLabelText("月")).toHaveValue("05");
  });

  it("詳細画面で残した記録だけを名称と値の対として表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...DETAIL_BASE,
          note: "窓側に設置。",
          productInfo: "三菱 霧ヶ峰 MSZ-ZW2224S",
          startedOn: "2024-05",
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

  // Issue #239: サービス系の大分類では「契約・利用を始めた時期」を
  // 「購入」と表現しない(YDR-033)。
  it("大分類「サービス」では開始時期を「利用・契約を始めた時期」として表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...DETAIL_BASE,
          kindCode: "service",
          kindLabel: "サービス",
          startedOn: "2024-05",
        }}
      />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(record).toHaveTextContent("利用・契約を始めた時期");
    expect(record).toHaveTextContent("2024年5月");
    expect(record).not.toHaveTextContent("購入時期");
  });

  it("年しか分からない開始時期を「ごろ」として表示する", () => {
    render(
      <ManagedItemDetailContent item={{ ...DETAIL_BASE, startedOn: "2024" }} />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(record).toHaveTextContent("2024年ごろ");
    // 残していない項目は表示しない。
    expect(record).not.toHaveTextContent("メモ");
    expect(record).not.toHaveTextContent("メーカー・商品名など");
  });

  // Issue #240: 記録がすべて未設定でも、編集導線(鉛筆アイコン)は失わない。
  // その一方で空メッセージや空の項目一覧は表示しない。
  it("記録が一つもない既存の管理対象でも編集導線だけは残し、空メッセージを表示しない", () => {
    render(<ManagedItemDetailContent item={DETAIL_BASE} />);

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(within(record).getByRole("link", { name: "管理対象を編集" }))
      .toHaveAttribute("href", "/managed-items/item-1/edit");
    expect(record).not.toHaveTextContent("メモ");
    expect(record).not.toHaveTextContent("メーカー・商品名など");
    expect(record).not.toHaveTextContent("購入時期");
    expect(
      screen.getByRole("heading", { name: "リビングのエアコン" }),
    ).toBeInTheDocument();
  });
});
