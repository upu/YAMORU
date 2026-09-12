import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// page.tsxはrequireUser経由でnext-authを読み込む。表示だけを確かめるため、
// ほかの画面テスト(tests/consumables-ui.test.tsxなど)と同じくauthを差し替える。
vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("../src/app/consumables/stock-actions", () => ({
  updateConsumableStockStatus: vi.fn(),
}));
vi.mock("../src/features/todos/actions/completion", () => ({
  completeMaintenanceTask: vi.fn(),
}));

import { CROSS_SEARCH_LIMIT, type CrossSearchResults } from "../src/lib/d1/cross-search";
import { SearchContent } from "../src/app/search/page";
import searchStyles from "../src/app/search/search-results.module.css";

afterEach(cleanup);

// Issue #350 / YDR-042: E2E(e2e/cross-search.spec.ts)は代表的な1件ずつの経路を
// 通す。ここでは実データを大量に用意しないと確かめにくい表示(上限の案内、
// 選べなくなった大分類のまとまり)を、結果の形から直接確認する。
function results(overrides: Partial<CrossSearchResults> = {}): CrossSearchResults {
  return {
    consumables: { hasMore: false, items: [] },
    managedItems: { hasMore: false, items: [] },
    todos: { hasMore: false, items: [] },
    ...overrides,
  };
}

const ACTOR_PROPS = {
  actorName: "自分",
  currentUserId: "user-1",
  members: [
    { nickname: "自分", userId: "user-1" },
    { nickname: "家族", userId: "user-2" },
  ],
};

describe("横断検索の画面", () => {
  it("検索語が無いときは0件表示ではなく使い方を案内する", () => {
    render(<SearchContent {...ACTOR_PROPS} hasHousehold q={undefined} results={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "検索" })).toBeInTheDocument();
    expect(screen.getByText(/名前を入力すると/u)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /に一致する対象はありません/u }))
      .not.toBeInTheDocument();
  });

  it("種類ごとにセクションを分け、消耗品には在庫状態を添える", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="卵"
        results={results({
          consumables: {
            hasMore: false,
            items: [{ id: "c1", name: "卵", stockStatus: "low" }],
          },
          managedItems: {
            hasMore: false,
            items: [{
              id: "m1",
              itemTypeLabel: "調理器具",
              kindCode: "asset",
              kindLabel: "備品",
              name: "卵焼き器",
            }],
          },
          todos: {
            hasMore: false,
            items: [{
              dueAt: "2026-09-10",
              id: "o1",
              managedItemId: null,
              recurrenceBasis: "once",
              scheduledFor: "2026-09-10",
              title: "卵を買う",
            }],
          },
        })}
      />,
    );

    const todoSection = screen.getByRole("region", { name: "Todo" });
    expect(within(todoSection).getByRole("link", { name: "卵を買う" }))
      .toHaveAttribute("href", "/todos/o1");
    expect(within(todoSection).getByText("9/10")).toBeInTheDocument();

    const assetSection = screen.getByRole("region", { name: "備品" });
    expect(within(assetSection).getByRole("link", { name: "卵焼き器" }))
      .toHaveAttribute("href", "/managed-items/m1");
    expect(within(assetSection).getByText("調理器具")).toBeInTheDocument();
    expect(within(assetSection).queryByRole("button")).not.toBeInTheDocument();

    const consumableSection = screen.getByRole("region", { name: "消耗品" });
    expect(within(consumableSection).getByRole("link", { name: "卵" }))
      .toHaveAttribute("href", "/consumables/c1");
    expect(within(consumableSection).getByRole("group", { name: "卵の在庫状態を変更" }))
      .toBeInTheDocument();
    expect(within(consumableSection).getByRole("button", { name: "少ない" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(consumableSection.querySelector(".stock-status-badge")).not.toBeInTheDocument();

    expect(within(todoSection).getByRole("button", { name: "卵を買うを記録" }))
      .toHaveTextContent("やったよ");
  });

  it("Todoのやったよから既存の完了記録ダイアログを開ける", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="掃除"
        results={results({
          todos: {
            hasMore: false,
            items: [{
              dueAt: null,
              id: "o1",
              managedItemId: "m1",
              recurrenceBasis: "once",
              scheduledFor: null,
              title: "換気扇掃除",
            }],
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "換気扇掃除を記録" }));

    expect(screen.getByRole("dialog", { name: "換気扇掃除を記録" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今、自分がやった" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "詳しく記録する" })).toBeInTheDocument();
  });

  it("メンテナンスの推奨期間は範囲、予定日未定はその旨を示す", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="掃除"
        results={results({
          todos: {
            hasMore: false,
            items: [
              { dueAt: "2026-09-20", id: "o1", managedItemId: null, recurrenceBasis: "once", scheduledFor: "2026-09-10", title: "浴室掃除" },
              { dueAt: null, id: "o2", managedItemId: null, recurrenceBasis: "once", scheduledFor: null, title: "換気扇掃除" },
            ],
          },
        })}
      />,
    );

    const todoSection = screen.getByRole("region", { name: "Todo" });
    expect(within(todoSection).getByText("9/10〜9/20")).toBeInTheDocument();
    expect(within(todoSection).getByText("予定日未定")).toBeInTheDocument();
  });

  // YDR-036で選べなくなった大分類の管理対象も、名前で探せば自分の見出しの下に出る。
  // 表示順は台帳の入口と同じ備品→サービス・契約とし、それ以外は後ろへ置く。
  it("大分類ごとにセクションをまとめ、台帳の入口と同じ順に並べる", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="家"
        results={results({
          managedItems: {
            hasMore: false,
            items: [
              { id: "m1", itemTypeLabel: null, kindCode: "other", kindLabel: "その他", name: "家の記録" },
              { id: "m2", itemTypeLabel: null, kindCode: "service", kindLabel: "サービス・契約", name: "家の保険" },
              { id: "m3", itemTypeLabel: null, kindCode: "asset", kindLabel: "備品", name: "家の掃除機" },
            ],
          },
        })}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["備品", "サービス・契約", "その他"]);
  });

  // Issue #325 / YDR-046: 「必要になったら繰り返す」Todoは日付が決まって
  // いないのではなく、日付を決めない方式そのもの。「予定日未定」と混同しない。
  it("必要になったら繰り返すTodoは「必要時」と示し、予定日未定と区別する", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="石灰"
        results={results({
          todos: {
            hasMore: false,
            items: [
              { dueAt: null, id: "o1", managedItemId: null, recurrenceBasis: "manual", scheduledFor: null, title: "石灰除去" },
              { dueAt: null, id: "o2", managedItemId: null, recurrenceBasis: "once", scheduledFor: null, title: "石灰対策の相談" },
            ],
          },
        })}
      />,
    );

    const rows = screen.getByRole("region", { name: "Todo" }).querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("必要時");
    expect(rows[0]).not.toHaveTextContent("予定日未定");
    expect(rows[1]).toHaveTextContent("予定日未定");
  });

  it("上限に達した種類にだけ、先頭何件を出しているかを案内する", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="詰め替え"
        results={results({
          consumables: {
            hasMore: true,
            items: [{ id: "c1", name: "詰め替え洗剤", stockStatus: "available" }],
          },
          todos: {
            hasMore: false,
            items: [{ dueAt: null, id: "o1", managedItemId: null, recurrenceBasis: "once", scheduledFor: null, title: "詰め替える" }],
          },
        })}
      />,
    );

    expect(screen.getByText(
      `消耗品の一致が多いため、先頭${String(CROSS_SEARCH_LIMIT)}件を表示しています。語を足すと絞り込めます。`,
    )).toBeInTheDocument();
    expect(screen.queryByText(/^Todoの一致が多いため/u)).not.toBeInTheDocument();
  });

  it("0件のときは検索語を示し、各一覧の入口を出す", () => {
    render(
      <SearchContent {...ACTOR_PROPS} hasHousehold q="ありえない名前" results={results()} />,
    );

    expect(screen.getByRole("heading", { name: "「ありえない名前」に一致する対象はありません" }))
      .toBeInTheDocument();
    // Issue #396: 一致が0件のときは分類の見出しを一つも置かない。
    for (const name of ["Todo", "備品", "サービス・契約", "消耗品"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Todo一覧を開く" })).toHaveAttribute("href", "/todos");
    expect(screen.getByRole("link", { name: "台帳（備品）を開く" }))
      .toHaveAttribute("href", "/managed-items?kind=asset");
    expect(screen.getByRole("link", { name: "台帳（消耗品）を開く" }))
      .toHaveAttribute("href", "/consumables");
  });

  it("家庭未所属では検索欄を出さず、家庭の作成を案内する", () => {
    render(
      <SearchContent {...ACTOR_PROPS} hasHousehold={false} q={undefined} results={null} />,
    );

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "家庭を作成してください" })).toBeInTheDocument();
  });
});

// Issue #396: 検索は候補を見比べて選ぶ画面なので、分類を保ったまま一画面に
// 見える件数を増やす。分類ごとの外側カードをやめ、囲いは結果行だけに残す。
describe("横断検索の結果の並べ方(Issue #396)", () => {
  // Issue #396: 分類ごとの外側カードと結果行の枠で二重の囲いになり、1件だけの
  // 分類でも大きな余白と見出しが縦幅を使っていた。分類は小さな見出しと件数
  // だけで示し、枠は結果行の側にだけ残す。
  it("分類は見出しと件数だけで示し、カードの枠を重ねない", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="卵"
        results={results({
          consumables: {
            hasMore: false,
            items: [{ id: "c1", name: "卵", stockStatus: "low" }],
          },
          managedItems: {
            hasMore: false,
            items: [
              { id: "m1", itemTypeLabel: "調理器具", kindCode: "asset", kindLabel: "備品", name: "卵焼き器" },
              { id: "m2", itemTypeLabel: null, kindCode: "service", kindLabel: "サービス・契約", name: "卵の定期便" },
            ],
          },
          todos: {
            hasMore: false,
            items: [
              { dueAt: null, id: "o1", managedItemId: null, recurrenceBasis: "once", scheduledFor: "2026-09-10", title: "卵を買う" },
              { dueAt: null, id: "o2", managedItemId: null, recurrenceBasis: "once", scheduledFor: null, title: "卵を茹でる" },
            ],
          },
        })}
      />,
    );

    for (const [name, count] of [
      ["Todo", "2件"],
      ["備品", "1件"],
      ["サービス・契約", "1件"],
      ["消耗品", "1件"],
    ]) {
      const group = screen.getByRole("region", { name });
      expect(group).toHaveClass(searchStyles.group);
      expect(group).not.toHaveClass("detail-card");
      expect(within(group).getByLabelText(count)).toBeInTheDocument();
      // 囲いを持つのは結果行の側だけ。
      expect(within(group).getAllByRole("listitem").length).toBeGreaterThan(0);
    }
  });

  // Issue #396: 一致のない分類は見出しごと出さないため、結果一覧を押し下げない。
  it("一致した分類だけを並べ、0件の分類は見出しも置かない", () => {
    render(
      <SearchContent
        {...ACTOR_PROPS}
        hasHousehold
        q="卵焼"
        results={results({
          managedItems: {
            hasMore: false,
            items: [{ id: "m1", itemTypeLabel: "調理器具", kindCode: "asset", kindLabel: "備品", name: "卵焼き器" }],
          },
        })}
      />,
    );

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "備品" })).toBeInTheDocument();
    for (const name of ["Todo", "サービス・契約", "消耗品"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
  });
});
