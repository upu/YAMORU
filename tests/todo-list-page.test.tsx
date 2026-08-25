import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  listPendingOccurrencesMock,
  loadAccountStateMock,
  loadActorNameMock,
  loadHouseholdMembersMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  listPendingOccurrencesMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  loadActorNameMock: vi.fn(),
  loadHouseholdMembersMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/home", () => ({
  listPendingOccurrences: listPendingOccurrencesMock,
}));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  FALLBACK_SELF_ACTOR_NAME: "あなた",
  loadActorName: loadActorNameMock,
  loadHouseholdMembers: loadHouseholdMembersMock,
}));

import TodoListPage from "../src/app/todos/page";

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
});

afterEach(cleanup);

describe("Todo一覧画面(TodoListPage、サーバーコンポーネント)", () => {
  it("家庭未所属の利用者では家庭作成を案内し、家庭専用データの取得を呼ばない", async () => {
    loadAccountStateMock.mockResolvedValue({ household: null, nickname: null });

    render(await TodoListPage());

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    // 家庭未所属だとrequireCurrentHouseholdIdが例外を投げるため、
    // これらは家庭所属チェックより後に呼ばれてはならない(Issue #144)。
    expect(listPendingOccurrencesMock).not.toHaveBeenCalled();
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

    render(await TodoListPage());

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

    render(await TodoListPage());

    expect(
      screen.getByRole("heading", { name: "未完了のTodoはありません" }),
    ).toBeInTheDocument();
  });
});
