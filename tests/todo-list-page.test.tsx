import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  listPendingOccurrencesMock,
  listRecentActiveCompletionsMock,
  loadAccountStateMock,
  loadActorNameMock,
  loadHouseholdMembersMock,
  loadProfileNamesMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  listPendingOccurrencesMock: vi.fn(),
  listRecentActiveCompletionsMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  loadActorNameMock: vi.fn(),
  loadHouseholdMembersMock: vi.fn(),
  loadProfileNamesMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/home", () => ({
  listPendingOccurrences: listPendingOccurrencesMock,
  listRecentActiveCompletions: listRecentActiveCompletionsMock,
}));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  FALLBACK_SELF_ACTOR_NAME: "あなた",
  loadActorName: loadActorNameMock,
  loadHouseholdMembers: loadHouseholdMembersMock,
  loadProfileNames: loadProfileNamesMock,
}));

import TodoListPage from "../src/app/todos/page";

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
  loadProfileNamesMock.mockResolvedValue(new Map());
});

afterEach(cleanup);

describe("Todo一覧画面(TodoListPage、サーバーコンポーネント)", () => {
  it("家庭未所属の利用者では家庭作成を案内し、家庭専用データの取得を呼ばない", async () => {
    loadAccountStateMock.mockResolvedValue({ household: null, nickname: null });

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    // 家庭未所属だとrequireCurrentHouseholdIdが例外を投げるため、
    // これらは家庭所属チェックより後に呼ばれてはならない(Issue #144)。
    expect(listPendingOccurrencesMock).not.toHaveBeenCalled();
    expect(listRecentActiveCompletionsMock).not.toHaveBeenCalled();
    expect(loadActorNameMock).not.toHaveBeenCalled();
    expect(loadHouseholdMembersMock).not.toHaveBeenCalled();
  });

  it("現在の家庭の未完了Todoだけを家庭単位の取得経路から読み出して表示する", async () => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue([{ nickname: "ぽっぷ", userId: "user-1" }]);
    listPendingOccurrencesMock.mockResolvedValue([
      {
        assignee_user_id: null,
        due_at: null,
        id: "occurrence-1",
        scheduled_for: null,
        task_rules: {
          deadline_kind: "strict",
          managed_items: null,
          recurrence_basis: "once",
          title: "通知書が届いたら申請",
        },
      },
    ]);

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, undefined);
    expect(
      screen.getByRole("heading", { level: 3, name: "通知書が届いたら申請" }),
    ).toBeInTheDocument();
  });

  it("未完了Todoが0件の家庭では空表示にする", async () => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue([]);
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "未完了のTodoはありません" }),
    ).toBeInTheDocument();
  });
});

// Issue #222
function completionRow(overrides: Record<string, unknown> = {}) {
  return {
    activity_log_id: "activity-1",
    managed_item_id: null,
    managed_item_name: null,
    occurred_at: "2026-08-10T00:00:00.000Z",
    performed_by_user_id: "user-2",
    task_occurrence_id: "occurrence-1",
    task_rule_title: "フィルター交換",
    ...overrides,
  };
}

describe("Todo一覧画面の実施済みタブ(TodoListPage、Issue #222)", () => {
  beforeEach(() => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue([]);
  });

  it("statusが未指定・pendingなら未完了タブを選択状態にし、実施済みの取得を呼ばない", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "未完了" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "実施済み" })).not.toHaveAttribute("aria-current");
    expect(listRecentActiveCompletionsMock).not.toHaveBeenCalled();
  });

  it("status=completedでは実施済みの取得経路から読み出し、実施日時と実施者を表示する", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([completionRow()]);
    loadProfileNamesMock.mockResolvedValue(new Map([["user-2", "たろう"]]));

    render(await TodoListPage({ searchParams: Promise.resolve({ status: "completed" }) }));

    expect(listPendingOccurrencesMock).not.toHaveBeenCalled();
    expect(listRecentActiveCompletionsMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, 20, undefined, undefined);
    expect(screen.getByRole("link", { name: "実施済み" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "実施済みのTodo" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "フィルター交換" });
    expect(link).toHaveAttribute("href", "/todos/occurrence-1");
    expect(screen.getByText(/たろうが実施/)).toBeInTheDocument();
  });

  it("実施済み一覧にはTodoカードの担当・完了操作を出さない", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([completionRow()]);

    render(await TodoListPage({ searchParams: Promise.resolve({ status: "completed" }) }));

    expect(screen.queryByLabelText("フィルター交換の担当")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "フィルター交換を記録" }),
    ).not.toBeInTheDocument();
  });

  it("実施済みが0件のときは実施済み向けの空表示にする", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({ status: "completed" }) }));

    expect(
      screen.getByRole("heading", { name: "実施済みのTodoはまだありません" }),
    ).toBeInTheDocument();
  });

  it("既定件数(20件)ちょうど返ると、次の20件を要求する「もっと見る」を出す", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => completionRow({
        activity_log_id: `activity-${String(index)}`,
        task_occurrence_id: `occurrence-${String(index)}`,
      })),
    );

    render(await TodoListPage({ searchParams: Promise.resolve({ status: "completed" }) }));

    expect(screen.getByRole("link", { name: "もっと見る" })).toHaveAttribute(
      "href",
      "/todos?limit=40&status=completed",
    );
  });

  it("既定件数未満なら「もっと見る」を出さない", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([completionRow()]);

    render(await TodoListPage({ searchParams: Promise.resolve({ status: "completed" }) }));

    expect(screen.queryByRole("link", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("limitクエリーパラメーターを取得件数上限へ反映し、上限(100件)を超えない", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => completionRow({
        activity_log_id: `activity-${String(index)}`,
        task_occurrence_id: `occurrence-${String(index)}`,
      })),
    );

    render(await TodoListPage({
      searchParams: Promise.resolve({ limit: "500", status: "completed" }),
    }));

    expect(listRecentActiveCompletionsMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, 100, undefined, undefined);
    // 上限に達しているため、これ以上の「もっと見る」は出さない。
    expect(screen.queryByRole("link", { name: "もっと見る" })).not.toBeInTheDocument();
  });
});

// Issue #223
const FILTER_MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    assignee_user_id: null,
    due_at: null,
    id: "occurrence-1",
    scheduled_for: null,
    task_rules: {
      deadline_kind: "strict",
      managed_items: null,
      recurrence_basis: "once",
      title: "家族会議",
    },
    ...overrides,
  };
}

describe("Todo一覧画面の担当予定者による絞り込み(TodoListPage、Issue #223)", () => {
  beforeEach(() => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue(FILTER_MEMBERS);
    listPendingOccurrencesMock.mockResolvedValue([]);
  });

  it("assignee未指定では絞り込みを渡さず、「全員」を選択状態にする", async () => {
    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, undefined);
    expect(screen.getByRole("link", { name: "全員" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "自分" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("担当: 全員", { selector: "summary" }).closest("details"))
      .not.toHaveAttribute("open");
  });

  it("assignee=自分のuserIdで、自分を担当予定者とする条件を渡す", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow()]);
    render(await TodoListPage({ searchParams: Promise.resolve({ assignee: "user-1" }) }));

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { type: "member", userId: "user-1" },
      undefined,
    );
    expect(screen.getByRole("link", { name: "自分" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "全員" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("担当: 自分", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByText(/担当予定者: 自分/)).toBeInTheDocument();
  });

  it("assignee=他メンバーのuserIdで、その名前を選択状態にする", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow()]);
    render(await TodoListPage({ searchParams: Promise.resolve({ assignee: "user-2" }) }));

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { type: "member", userId: "user-2" },
      undefined,
    );
    expect(screen.getByRole("link", { name: "たろう" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("担当: たろう", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByText(/担当予定者: たろう/)).toBeInTheDocument();
  });

  it("assignee=unassignedで担当未定の条件を渡す", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow()]);
    render(await TodoListPage({ searchParams: Promise.resolve({ assignee: "unassigned" }) }));

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { type: "unassigned" },
      undefined,
    );
    expect(screen.getByRole("link", { name: "担当未定" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("担当: 担当未定", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByText(/担当予定者: 担当未定/)).toBeInTheDocument();
  });

  it("状態タブを切り替えても担当条件を保つ", async () => {
    render(await TodoListPage({ searchParams: Promise.resolve({ assignee: "user-2" }) }));

    expect(screen.getByRole("link", { name: "実施済み" })).toHaveAttribute(
      "href",
      "/todos?status=completed&assignee=user-2",
    );
    expect(screen.getByRole("link", { name: "未完了" })).toHaveAttribute(
      "href",
      "/todos?assignee=user-2",
    );
  });

  it("担当条件を切り替えても状態(実施済み)を保つ", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([]);

    render(await TodoListPage({
      searchParams: Promise.resolve({ status: "completed" }),
    }));

    expect(screen.getByRole("link", { name: "たろう" })).toHaveAttribute(
      "href",
      "/todos?status=completed&assignee=user-2",
    );
    expect(screen.getByRole("link", { name: "全員" })).toHaveAttribute("href", "/todos?status=completed");
  });

  it("別家庭・不正なuserIdを指定しても、実在する家庭メンバーの表示名は出さない", async () => {
    render(await TodoListPage({
      searchParams: Promise.resolve({ assignee: "someone-elses-id" }),
    }));

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { type: "member", userId: "someone-elses-id" },
      undefined,
    );
    // 家庭外の値では、どのチップも選択状態にならず、適用中の条件も説明しない
    // (household_idで絞り込むlistPendingOccurrences自体が安全に0件を返す。
    // src/lib/d1/home.tsのD1テスト参照)。
    expect(screen.getByRole("link", { name: "全員" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "自分" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "たろう" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "担当未定" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByText(/担当予定者:/)).not.toBeInTheDocument();
  });
});

// Issue #225
describe("Todo一覧画面のフリーワード検索(TodoListPage、Issue #225)", () => {
  beforeEach(() => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue(FILTER_MEMBERS);
  });

  it("q未指定では検索条件を渡さず、検索欄は空にし、虫眼鏡の検索は閉じておく(Issue #241)", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, undefined);
    expect(screen.getByRole("searchbox", { name: "Todo名で検索" })).toHaveValue("");
    const disclosure = document.querySelector(".todo-search-disclosure");
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("qでTodo名の検索条件を渡し、適用中の検索語と検索欄の値を表示し、虫眼鏡の検索を開いておく(Issue #241)", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow({
      task_rules: {
        deadline_kind: "strict",
        managed_items: null,
        recurrence_basis: "once",
        title: "洗剤を補充",
      },
    })]);

    render(await TodoListPage({ searchParams: Promise.resolve({ q: "洗剤" }) }));

    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, "洗剤");
    expect(screen.getByRole("searchbox", { name: "Todo名で検索" })).toHaveValue("洗剤");
    expect(screen.getByText(/検索語: 「洗剤」/)).toBeInTheDocument();
    // 再読み込み・URL共有後も検索状態を見失わないよう、検索語が適用中なら
    // 検索欄を開いた状態で描画する(受け入れ基準)。
    const disclosure = document.querySelector(".todo-search-disclosure");
    expect(disclosure).toHaveAttribute("open");
  });

  it("前後の空白は取り除き、空白だけ・空文字なら検索条件なしとして扱う", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({ q: "  洗剤  " }) }));
    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, "洗剤");

    listPendingOccurrencesMock.mockClear();
    render(await TodoListPage({ searchParams: Promise.resolve({ q: "   " }) }));
    expect(listPendingOccurrencesMock)
      .toHaveBeenCalledWith({}, { userId: "user-1" }, undefined, undefined);
  });

  it("検索結果が0件のときは検索語を含む専用の案内を出す(家庭が空のときの案内とは区別する)", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({ searchParams: Promise.resolve({ q: "存在しない" }) }));

    expect(
      screen.getByRole("heading", { name: "「存在しない」に一致するTodoはありません" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "未完了のTodoはありません" })).not.toBeInTheDocument();
  });

  it("状態タブ・担当条件を切り替えても検索語を保つ", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({
      searchParams: Promise.resolve({ assignee: "user-2", q: "洗剤" }),
    }));

    expect(screen.getByRole("link", { name: "実施済み" })).toHaveAttribute(
      "href",
      "/todos?status=completed&assignee=user-2&q=%E6%B4%97%E5%89%A4",
    );
    expect(screen.getByRole("link", { name: "全員" })).toHaveAttribute(
      "href",
      "/todos?q=%E6%B4%97%E5%89%A4",
    );
  });

  it("検索語と担当条件を組み合わせて両方渡す", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({
      searchParams: Promise.resolve({ assignee: "user-1", q: "洗剤" }),
    }));

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      { type: "member", userId: "user-1" },
      "洗剤",
    );
  });
});

// Issue #224
describe("Todo一覧画面のカード/リスト表示切り替え(TodoListPage、Issue #224)", () => {
  beforeEach(() => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue(FILTER_MEMBERS);
  });

  it("view未指定では既定のカード表示にし、現在の操作性(担当・完了)を維持する", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow({ assignee_user_id: "user-2" })]);

    render(await TodoListPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "カード表示" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "リスト表示" })).not.toHaveAttribute("aria-current");
    expect(screen.getByLabelText("家族会議の担当")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "家族会議を記録" })).toBeInTheDocument();
  });

  it("view=listではコンパクトなリスト表示にし、識別に必要な情報(名前・予定・担当)を行内に表示する", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow({ assignee_user_id: "user-2" })]);

    render(await TodoListPage({ searchParams: Promise.resolve({ view: "list" }) }));

    expect(screen.getByRole("link", { name: "リスト表示" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "カード表示" })).not.toHaveAttribute("aria-current");
    // カードの変更操作(誤操作を避けるため詳細へ集約、issue本文の設計メモ)は出さない。
    expect(screen.queryByLabelText("家族会議の担当")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "家族会議を記録" })).not.toBeInTheDocument();
    // 行全体がTodo詳細への単一の導線になる。
    const rowLink = screen.getByRole("link", { name: /家族会議/ });
    expect(rowLink).toHaveAttribute("href", "/todos/occurrence-1");
    // Issue #243: 予定日未定はバッジ(未定)で示し、行の予定表現では重複させない。
    expect(rowLink).toHaveTextContent("未定");
    expect(rowLink).not.toHaveTextContent("予定日:");
    // 見た目は「担当:」を出さず値だけを表示する(受け入れ基準)。
    expect(rowLink).toHaveTextContent("たろう");
    expect(rowLink).not.toHaveTextContent("担当:");
    // 支援技術には担当予定者の値であることが伝わる(sr-onlyラベル)。
    expect(rowLink.querySelector(".sr-only")).toHaveTextContent("担当予定者:");
  });

  it("担当未定のTodoはリスト表示で「未定」と表示する", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow()]);

    render(await TodoListPage({ searchParams: Promise.resolve({ view: "list" }) }));

    const rowLink = screen.getByRole("link", { name: /家族会議/ });
    expect(rowLink).toHaveTextContent("未定");
    expect(rowLink).not.toHaveTextContent("担当未定");
  });

  it("予定日があるTodoはリスト表示で短い日付表現(例: 8/28)にし、繰り返し方式は省略する", async () => {
    listPendingOccurrencesMock.mockResolvedValue([pendingRow({
      due_at: "2026-09-10T00:00:00.000Z",
      scheduled_for: "2026-09-10T00:00:00.000Z",
      task_rules: {
        deadline_kind: "strict",
        managed_items: null,
        recurrence_basis: "calendar",
        title: "家族会議",
      },
    })]);

    render(await TodoListPage({ searchParams: Promise.resolve({ view: "list" }) }));

    const rowLink = screen.getByRole("link", { name: /家族会議/ });
    expect(rowLink).toHaveTextContent("9/10");
    expect(rowLink).not.toHaveTextContent("の予定です");
    expect(rowLink).not.toHaveTextContent("繰り返し");
  });

  it("実施済みのリスト表示では担当予定者ラベルを重ねず、実施者情報(meta)だけを表示する", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue([completionRow()]);
    loadProfileNamesMock.mockResolvedValue(new Map([["user-2", "たろう"]]));

    render(await TodoListPage({
      searchParams: Promise.resolve({ status: "completed", view: "list" }),
    }));

    const rowLink = screen.getByRole("link", { name: /フィルター交換/ });
    // Issue #243: 実施時期・実施者を短く表示する。カード向けの「が実施」
    // という文は行表示では組み立てない(実施日時・実施者を直接使う)。
    expect(rowLink).toHaveTextContent("8/10");
    expect(rowLink).toHaveTextContent("たろう");
    expect(rowLink).not.toHaveTextContent("担当:");
  });

  it("状態タブ・担当条件・検索を切り替えても表示形式(view=list)を保つ", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({
      searchParams: Promise.resolve({ assignee: "user-2", q: "洗剤", view: "list" }),
    }));

    expect(screen.getByRole("link", { name: "実施済み" })).toHaveAttribute(
      "href",
      "/todos?status=completed&assignee=user-2&q=%E6%B4%97%E5%89%A4&view=list",
    );
    expect(screen.getByRole("link", { name: "全員" })).toHaveAttribute(
      "href",
      "/todos?q=%E6%B4%97%E5%89%A4&view=list",
    );
    // 検索フォームの再送信でも表示形式を失わない(hidden input)。
    const searchForm = screen.getByRole("form", { name: "Todoをフリーワードで検索" });
    expect(searchForm.querySelector('input[name="view"]')).toHaveValue("list");
  });

  it("カード表示に戻す・切り替えるリンクは他の絞り込みを保ったまま組み立てる", async () => {
    listPendingOccurrencesMock.mockResolvedValue([]);

    render(await TodoListPage({
      searchParams: Promise.resolve({ assignee: "user-2", view: "list" }),
    }));

    expect(screen.getByRole("link", { name: "カード表示" })).toHaveAttribute(
      "href",
      "/todos?assignee=user-2",
    );
    expect(screen.getByRole("link", { name: "リスト表示" })).toHaveAttribute(
      "href",
      "/todos?assignee=user-2&view=list",
    );
  });

  it("リスト表示の実施済みタブで「もっと見る」リンクは表示形式を保つ", async () => {
    listRecentActiveCompletionsMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => completionRow({
        activity_log_id: `activity-${String(index)}`,
        task_occurrence_id: `occurrence-${String(index)}`,
      })),
    );

    render(await TodoListPage({
      searchParams: Promise.resolve({ status: "completed", view: "list" }),
    }));

    expect(screen.getByRole("link", { name: "もっと見る" })).toHaveAttribute(
      "href",
      "/todos?limit=40&status=completed&view=list",
    );
  });
});
