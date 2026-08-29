import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  listHouseholdCustomItemTypesMock,
  listManagedItemClassificationOptionsMock,
  listManagedItemsMock,
  loadAccountStateMock,
  requireUserMock,
  routerPushMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  listHouseholdCustomItemTypesMock: vi.fn(),
  listManagedItemClassificationOptionsMock: vi.fn(),
  listManagedItemsMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  requireUserMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPushMock }) }));
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

  it("条件未指定では絞り込みを渡さず、検索欄と詳しい種類の候補を閉じ、条件クリアリンクは出さない", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(listManagedItemsMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { customItemType: undefined, itemTypeCode: undefined, kindCode: undefined, search: undefined },
    );
    expect(screen.getByRole("searchbox", { name: "管理対象名で検索" })).toHaveValue("");
    expect(screen.getByText(/詳しい種類の候補は閉じています/)).toHaveClass("sr-only");
    expect(screen.queryByRole("radio", { name: "すべて" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "詳しい種類「家電」を解除" }))
      .toHaveAttribute("href", "/managed-items?kind=asset");
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
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

  it("入力に一致した詳しい種類を大分類ごとのグループで示す", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    const picker = screen.getByRole("group", { name: "詳しい種類で絞り込み" });
    const searchbox = within(picker).getByRole("searchbox", { name: "詳しい種類の一部を入力" });
    fireEvent.change(searchbox, { target: { value: "家電" } });
    const monoGroup = within(picker).getByRole("group", { name: "モノ" });
    expect(within(monoGroup).getByRole("radio", { name: "家電" })).toBeInTheDocument();
    fireEvent.change(searchbox, { target: { value: "契約" } });
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
  it("家庭内で使われている自由入力の候補を、入力に一致したとき表示する", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    expect(listHouseholdCustomItemTypesMock).toHaveBeenCalledWith({}, { userId: "user-1" });
    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "かご" },
    });
    const monoGroup = screen.getByRole("group", { name: "モノ" });
    expect(within(monoGroup).getByRole("radio", { name: "虫かご（自由入力）" })).toBeInTheDocument();
    expect(within(monoGroup).queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "詳しい種類「虫かご」を解除" }))
      .toHaveAttribute("href", "/managed-items");
    expect(screen.queryByRole("radio", { name: "虫かご（自由入力）" })).not.toBeInTheDocument();
  });

  it("プリセットと同じ表記の自由入力候補も、区別して両方選べる(同名候補)", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "家電" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "家電" },
    });
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

  it("空白だけの入力は未入力と同じく候補を閉じる", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);

    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "   " },
    });

    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "虫かご（自由入力）" })).not.toBeInTheDocument();
    expect(screen.getByText(/詳しい種類の候補は閉じています/)).toHaveClass("sr-only");
  });

  it("一致する候補がないときは候補なしを案内する", async () => {
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "存在しない種類" },
    });

    expect(screen.getByText("一致する詳しい種類がありません。")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
  });

  it("選択中の候補が検索語に一致しなくても、候補外の適用中表示に残る", async () => {
    listManagedItemsMock.mockResolvedValue([itemRow()]);

    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset" }),
    }));

    fireEvent.change(screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" }), {
      target: { value: "契約" },
    });

    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "詳しい種類「家電」を解除" }))
      .toBeInTheDocument();
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
    expect(screen.queryByRole("radio", { name: "すべて" })).not.toBeInTheDocument();
    expect(screen.getByText(/詳しい種類の候補は閉じています/)).toHaveClass("sr-only");
  });
});

describe("台帳一覧の分類絞り込みの即時反映(ManagedItemsPage、Issue #268)", () => {
  it("詳しい種類が未入力なら候補を閉じ、入力したときだけ一致候補と件数を表示する", async () => {
    listHouseholdCustomItemTypesMock.mockResolvedValue([{ kindCode: "asset", label: "虫かご" }]);
    render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));

    const input = screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" });
    expect(screen.getByText(/詳しい種類の候補は閉じています/)).toHaveClass("sr-only");
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "虫かご（自由入力）" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "かご" } });

    expect(screen.getByRole("radio", { name: "虫かご（自由入力）" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
    expect(screen.getByText("1件見つかりました。")).toBeInTheDocument();
  });

  it("大分類を選ぶと、適用済みの名前検索と詳しい種類を保って即時遷移する", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset", q: "冷蔵庫" }),
    }));

    fireEvent.change(screen.getByLabelText("大分類で絞り込み"), {
      target: { value: "service" },
    });

    expect(routerPushMock).toHaveBeenCalledWith(
      "/managed-items?kind=service&itemType=appliance&q=%E5%86%B7%E8%94%B5%E5%BA%AB",
    );
  });

  it("詳しい種類と「すべて」を選ぶと、ほかの条件を保って即時適用・解除する", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ kind: "asset", q: "冷蔵庫" }),
    }));
    const input = screen.getByRole("searchbox", { name: "詳しい種類の一部を入力" });
    fireEvent.change(input, { target: { value: "家電" } });

    fireEvent.click(screen.getByRole("radio", { name: "家電" }));
    expect(routerPushMock).toHaveBeenLastCalledWith(
      "/managed-items?kind=asset&itemType=appliance&q=%E5%86%B7%E8%94%B5%E5%BA%AB",
    );

    fireEvent.click(screen.getByRole("radio", { name: "すべて" }));
    expect(routerPushMock).toHaveBeenLastCalledWith(
      "/managed-items?kind=asset&q=%E5%86%B7%E8%94%B5%E5%BA%AB",
    );
  });

  it("適用中の詳しい種類を候補外で確認し、その条件だけ解除できる", async () => {
    render(await ManagedItemsPage({
      searchParams: Promise.resolve({ itemType: "appliance", kind: "asset", q: "冷蔵庫" }),
    }));

    expect(screen.getByRole("link", { name: "詳しい種類「家電」を解除" })).toHaveAttribute(
      "href",
      "/managed-items?kind=asset&q=%E5%86%B7%E8%94%B5%E5%BA%AB",
    );
    expect(screen.queryByRole("radio", { name: "家電" })).not.toBeInTheDocument();
  });

  it("管理対象名は明示的に検索し、JavaScript無効時に分類を送信できるフォームを残す", async () => {
    const { container } = render(await ManagedItemsPage({ searchParams: Promise.resolve({}) }));
    const form = screen.getByRole("form", { name: "台帳を検索・絞り込み" });

    expect(screen.getByRole("button", { name: "名前を検索" })).toBeInTheDocument();
    expect(form).toHaveAttribute("action", "/managed-items");
    expect(form).toHaveAttribute("method", "get");
    expect(container.innerHTML).toContain("<noscript>");

    fireEvent.change(screen.getByRole("searchbox", { name: "管理対象名で検索" }), {
      target: { value: "  冷蔵庫  " },
    });
    fireEvent.submit(form);
    expect(routerPushMock).toHaveBeenLastCalledWith(
      "/managed-items?q=%E5%86%B7%E8%94%B5%E5%BA%AB",
    );

    const serverHtml = renderToStaticMarkup(
      await ManagedItemsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(serverHtml).toContain("分類の変更を反映");
    expect(serverHtml).toContain("name=\"itemType\"");
  });
});
