import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  listManagedItemClassificationOptionsMock,
  listManagedItemsMock,
  loadAccountStateMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  listManagedItemClassificationOptionsMock: vi.fn(),
  listManagedItemsMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/managed-items", () => ({
  listManagedItemClassificationOptions: listManagedItemClassificationOptionsMock,
  listManagedItems: listManagedItemsMock,
}));

import ManagedItemsPage from "../src/app/managed-items/page";

// Issue #218: 大分類2種・詳しい種類2種の最小構成。
const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "appliance", kindCode: "asset", label: "家電" },
    { code: "contract", kindCode: "service", label: "契約" },
  ],
  kinds: [
    { code: "asset", label: "モノ" },
    { code: "service", label: "サービス" },
  ],
};

function itemRow(overrides: Partial<{
  id: string;
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
}> = {}) {
  return {
    id: "item-1",
    itemTypeLabel: "家電",
    kindLabel: "モノ",
    name: "リビングの冷蔵庫",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
  loadAccountStateMock.mockResolvedValue({
    household: { id: "household-1", name: "テスト家庭" },
    nickname: "ぽっぷ",
  });
  listManagedItemClassificationOptionsMock.mockResolvedValue(CLASSIFICATION_OPTIONS);
  listManagedItemsMock.mockResolvedValue([]);
});

afterEach(cleanup);

describe("台帳一覧の検索・絞り込み(ManagedItemsPage、Issue #218)", () => {
  it("家庭未所属の利用者では家庭作成を案内し、家庭専用データの取得を呼ばない", async () => {
    loadAccountStateMock.mockResolvedValue({ household: null, nickname: null });

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(listManagedItemsMock).not.toHaveBeenCalled();
    expect(listManagedItemClassificationOptionsMock).not.toHaveBeenCalled();
  });

  it("条件未指定では絞り込みを渡さず、検索欄は空・条件クリアリンクは出さない", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {}, { userId: "user-1" }, { itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.getByRole("searchbox", { name: "管理対象名で検索" })).toHaveValue("");
    expect(screen.queryByRole("link", { name: "条件をクリア" })).not.toBeInTheDocument();
  });

  it("qで名前検索の条件を渡し、適用中の検索語と検索欄の値を表示する", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow({ name: "浄水フィルター" })]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "浄水" }) }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {}, { userId: "user-1" }, { itemTypeCode: undefined, kindCode: undefined, search: "浄水" },
    );
    expect(screen.getByRole("searchbox", { name: "管理対象名で検索" })).toHaveValue("浄水");
    expect(screen.getByText(/検索語: 「浄水」/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "条件をクリア" })).toHaveAttribute(
      "href", "/managed-items",
    );
  });

  it("前後の空白は取り除き、空白だけ・空文字なら検索条件なしとして扱う", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "  浄水  " }) }));
    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {}, { userId: "user-1" }, { itemTypeCode: undefined, kindCode: undefined, search: "浄水" },
    );

    listManagedItemsMock.mockClear();
    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "   " }) }));
    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {}, { userId: "user-1" }, { itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
  });

  it("kind・itemTypeで大分類・詳しい種類の条件を渡し、家族に見せる名前で表示する", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { itemTypeCode: "appliance", kindCode: "asset", search: undefined },
    );
    expect(screen.getByText(/大分類: モノ/)).toBeInTheDocument();
    expect(screen.getByText(/詳しい種類: 家電/)).toBeInTheDocument();
  });

  it("検索語・大分類・詳しい種類を組み合わせて同時に適用し、まとめて解除できる", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset", q: "冷蔵庫" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { itemTypeCode: "appliance", kindCode: "asset", search: "冷蔵庫" },
    );
    expect(screen.getByText("大分類: モノ ・ 詳しい種類: 家電 ・ 検索語: 「冷蔵庫」")).toBeInTheDocument();
    // 複数条件を一度にまとめて解除できる(受け入れ基準)。
    expect(screen.getByRole("link", { name: "条件をクリア" })).toHaveAttribute(
      "href", "/managed-items",
    );
  });

  it("結果件数を見出しの件数バッジに表示する", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow({ id: "item-1" }), itemRow({ id: "item-2" })]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText("2件")).toHaveTextContent("2");
  });

  it("家庭にまだ管理対象がない(絞り込みなし)場合は登録を促す案内を出す", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/まだ管理対象はありません。/)).toBeInTheDocument();
    expect(screen.queryByText(/に一致する管理対象はありません/)).not.toBeInTheDocument();
  });

  it("絞り込みの結果が0件のときは、条件を変える案内を家庭が空の場合と区別して出す", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "存在しない" }) }));

    expect(
      screen.getByText("検索語: 「存在しない」に一致する管理対象はありません。検索語や絞り込みを変えてお試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("まだ管理対象はありません。右下の⊕から台帳に追加できます。")).not.toBeInTheDocument();
  });

  it("大分類の選択肢ごとに詳しい種類をoptgroupでまとめ、他家庭に関係なく分類の全候補を示す", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    const itemTypeSelect = screen.getByRole("combobox", { name: "詳しい種類で絞り込み" });
    const monoGroup = within(itemTypeSelect).getByRole("group", { name: "モノ" });
    expect(within(monoGroup).getByRole("option", { name: "家電" })).toBeInTheDocument();
    const serviceGroup = within(itemTypeSelect).getByRole("group", { name: "サービス" });
    expect(within(serviceGroup).getByRole("option", { name: "契約" })).toBeInTheDocument();
  });

  it("不正な大分類・詳しい種類の値は絞り込み条件として渡すが、家族向けの説明は出さない", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "no-such-type", kind: "no-such-kind" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { itemTypeCode: "no-such-type", kindCode: "no-such-kind", search: undefined },
    );
    // 条件不明なときは適用中の条件そのものを説明しない(結果は0件になるため、
    // 誤って絞り込みが効いていないように見せない)。まとめ解除リンクも出さない。
    expect(screen.queryByRole("link", { name: "条件をクリア" })).not.toBeInTheDocument();
  });
});
