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

    expect(listPendingOccurrencesMock).toHaveBeenCalledWith({}, { userId: "user-1" });
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
    expect(listRecentActiveCompletionsMock).toHaveBeenCalledWith({}, { userId: "user-1" }, 20);
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
      "/todos?status=completed&limit=40",
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

    expect(listRecentActiveCompletionsMock).toHaveBeenCalledWith({}, { userId: "user-1" }, 100);
    // 上限に達しているため、これ以上の「もっと見る」は出さない。
    expect(screen.queryByRole("link", { name: "もっと見る" })).not.toBeInTheDocument();
  });
});
