import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  listHouseholdCustomItemTypesMock,
  listManagedItemClassificationOptionsMock,
  listManagedItemsMock,
  loadAccountStateMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  listHouseholdCustomItemTypesMock: vi.fn(),
  listManagedItemClassificationOptionsMock: vi.fn(),
  listManagedItemsMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/managed-items", () => ({
  listHouseholdCustomItemTypes: listHouseholdCustomItemTypesMock,
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
  listHouseholdCustomItemTypesMock.mockResolvedValue([]);
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
    expect(listHouseholdCustomItemTypesMock).not.toHaveBeenCalled();
  });

  it("条件未指定では絞り込みを渡さず、検索欄は空・「すべて」を選択・条件クリアリンクは出さない", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.getByRole("searchbox", { name: "管理対象名で検索" })).toHaveValue("");
    expect(screen.getByRole("radio", { name: "すべて" })).toBeChecked();
    expect(screen.queryByRole("link", { name: "条件をクリア" })).not.toBeInTheDocument();
  });

  it("qで名前検索の条件を渡し、適用中の検索語と検索欄の値を表示する", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow({ name: "浄水フィルター" })]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "浄水" }) }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: "浄水" },
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
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: "浄水" },
    );

    listManagedItemsMock.mockClear();
    render(await ManagedItemsPage({ searchParams: Promise.resolve({ q: "   " }) }));
    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
  });

  it("kind・itemType(プリセット)で大分類・詳しい種類の条件を渡し、家族に見せる名前で表示・選択する", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: "appliance", kindCode: "asset", search: undefined },
    );
    expect(screen.getByText(/大分類: モノ/)).toBeInTheDocument();
    expect(screen.getByText(/詳しい種類: 家電/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "家電" })).toBeChecked();
  });

  it("検索語・大分類・詳しい種類を組み合わせて同時に適用し、まとめて解除できる", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset", q: "冷蔵庫" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: "appliance", kindCode: "asset", search: "冷蔵庫" },
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

  it("大分類の選択肢ごとに詳しい種類をグループでまとめ、他家庭に関係なく分類の全候補を示す", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    const picker = screen.getByRole("group", { name: "詳しい種類で絞り込み" });
    const monoGroup = within(picker).getByRole("group", { name: "モノ" });
    expect(within(monoGroup).getByRole("radio", { name: "家電" })).toBeInTheDocument();
    const serviceGroup = within(picker).getByRole("group", { name: "サービス" });
    expect(within(serviceGroup).getByRole("radio", { name: "契約" })).toBeInTheDocument();
  });

  it("不正な大分類・詳しい種類(プリセット)の値は絞り込み条件として渡すが、家族向けの説明は出さない", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "no-such-type", kind: "no-such-kind" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: "no-such-type", kindCode: "no-such-kind", search: undefined },
    );
    // 条件不明なときは適用中の条件そのものを説明しない(結果は0件になるため、
    // 誤って絞り込みが効いていないように見せない)。まとめ解除リンクも出さない。
    expect(screen.queryByRole("link", { name: "条件をクリア" })).not.toBeInTheDocument();
  });
});

// Issue #238: 自由入力した詳しい種類も、プリセットと同じ候補一覧から検索・
// 選択して絞り込める。
describe("台帳一覧の自由入力(詳しい種類)候補・絞り込み(ManagedItemsPage、Issue #238)", () => {
  it("家庭内で使われている自由入力の候補をプリセットと同じ候補一覧に表示する", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(listHouseholdCustomItemTypesMock).toHaveBeenCalledWith({}, { userId: "user-1" });
    const monoGroup = screen.getByRole("group", { name: "モノ" });
    expect(within(monoGroup).getByRole("radio", { name: "家電" })).toBeInTheDocument();
    expect(within(monoGroup).getByRole("radio", { name: "虫かご（自由入力）" })).toBeInTheDocument();
  });

  it("itemType=custom:の条件を渡し、家族に見せる名前で表示・選択する", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);
    listManagedItemsMock.mockResolvedValue([
      itemRow({ itemTypeLabel: "虫かご", name: "カブトムシの虫かご" }),
    ]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "custom:虫かご" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: "虫かご", itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.getByText(/詳しい種類: 虫かご/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "虫かご（自由入力）" })).toBeChecked();
  });

  it("プリセットと同じ表記の自由入力候補も、区別して両方選べる(同名候補)", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "家電" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    const monoGroup = screen.getByRole("group", { name: "モノ" });
    const presetOption = within(monoGroup).getByRole("radio", { name: "家電" });
    const customOption = within(monoGroup).getByRole("radio", { name: "家電（自由入力）" });
    expect(presetOption).toHaveAttribute("value", "appliance");
    expect(customOption).toHaveAttribute("value", "custom:家電");
    expect(presetOption).not.toBe(customOption);
  });

  it("テキスト入力で候補を日本語の部分一致で絞り、一致しない候補を除く", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "かご" },
    });

    expect(screen.getByRole("radio", { name: "虫かご（自由入力）" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
    // 「すべて」は検索語による絞り込み対象にしない。
    expect(screen.getByRole("radio", { name: "すべて" })).toBeInTheDocument();
  });

  it("空白だけの入力は絞り込みなし(全候補表示)として扱う", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "   " },
    });

    expect(screen.getByRole("radio", { name: "家電" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "虫かご（自由入力）" })).toBeInTheDocument();
  });

  it("一致する候補がないときは候補なしを案内する", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "存在しない種類" },
    });

    expect(screen.getByText("一致する詳しい種類がありません。")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
  });

  it("選択中の候補は、検索語に一致しなくても候補として残り、選択したままになる", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset" }),
    }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "契約" },
    });

    const selected = screen.getByRole("radio", { name: "家電" });
    expect(selected).toBeInTheDocument();
    expect(selected).toBeChecked();
  });

  it("不正な自由入力の値(家庭内で使われていない)は絞り込み条件として渡すが、家族向けの説明は出さない", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "custom:存在しない種類" }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: "存在しない種類", itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.queryByText(/詳しい種類:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "条件をクリア" })).not.toBeInTheDocument();
  });

  it("itemType=custom: の後ろが空白だけの場合は絞り込みなしとして扱う", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "custom:   " }),
    }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.getByRole("radio", { name: "すべて" })).toBeChecked();
  });
});
