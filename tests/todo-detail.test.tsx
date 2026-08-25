import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  loadActorNameMock,
  loadHouseholdMembersMock,
  loadTodoDetailMock,
  notFoundMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  loadActorNameMock: vi.fn(),
  loadHouseholdMembersMock: vi.fn(),
  loadTodoDetailMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ loadTodoDetail: loadTodoDetailMock }));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  loadActorName: loadActorNameMock,
  loadHouseholdMembers: loadHouseholdMembersMock,
}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("../src/app/managed-items/[id]/actions", () => ({
  correctCompletionOccurredAt: vi.fn(),
  correctCompletionPerformer: vi.fn(),
  undoMaintenanceTaskCompletion: vi.fn(),
}));

import TodoDetailPage, {
  TodoDetailContent,
  type TodoDetailData,
} from "../src/app/todos/[id]/page";

const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];

function todo(overrides: Partial<TodoDetailData> = {}): TodoDetailData {
  return {
    assigneeName: null,
    completion: null,
    dueAt: "2026-09-01T15:00:00.000Z",
    id: "occurrence-1",
    isCompleted: false,
    isMaintenance: false,
    managedItemId: "item-1",
    managedItemName: "猫の浄水器",
    recurrenceBasis: "once",
    scheduledFor: "2026-09-01T15:00:00.000Z",
    title: "フィルターの申請",
    ...overrides,
  };
}

function completedTodo(overrides: Partial<TodoDetailData> = {}): TodoDetailData {
  return todo({
    completion: {
      occurredAt: "2026-09-03T15:00:00.000Z",
      performedByUserId: "user-2",
      performerName: "たろう",
    },
    isCompleted: true,
    ...overrides,
  });
}

function renderDetail(data: TodoDetailData) {
  return render(
    <TodoDetailContent currentUserId="user-1" members={MEMBERS} todo={data} />,
  );
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    assignee_user_id: null,
    completed_activity_log_id: null,
    deadline_kind: "strict",
    due_at: "2026-09-01T15:00:00.000Z",
    id: "occurrence-1",
    managed_item_id: null,
    managed_item_name: null,
    occurred_at: null,
    performed_by_user_id: null,
    recurrence_basis: "once",
    scheduled_for: "2026-09-01T15:00:00.000Z",
    status: "pending",
    title: "通知書が届いたら申請",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
  loadHouseholdMembersMock.mockResolvedValue(MEMBERS);
});

afterEach(cleanup);

describe("未完了Todoの詳細(TodoDetailContent)", () => {
  it("Todo名、状態、繰り返し方、関連する管理対象、担当、予定日を表示する", () => {
    renderDetail(todo({ assigneeName: "ぽっぷ" }));

    expect(screen.getByRole("heading", { level: 1, name: "フィルターの申請" }))
      .toBeInTheDocument();
    expect(screen.getByText("未完了")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
    expect(screen.getByText("繰り返しなし")).toBeInTheDocument();
    expect(screen.getByText("ぽっぷ")).toBeInTheDocument();
    expect(screen.getByText("2026年9月2日")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Todo一覧へ戻る" })).toHaveAttribute(
      "href",
      "/todos",
    );
  });

  it("担当が未設定なら誰でも可、管理対象がなければ関連なしと表示する", () => {
    renderDetail(todo({ managedItemId: null, managedItemName: null }));

    expect(screen.getByText("誰でも可")).toBeInTheDocument();
    expect(screen.getByText("関連する管理対象なし")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "猫の浄水器" })).not.toBeInTheDocument();
  });

  it("予定日未定のTodoは予定日を未定として表示する", () => {
    renderDetail(todo({ dueAt: null, scheduledFor: null }));

    expect(screen.getByText("未定")).toBeInTheDocument();
  });

  it("延期して期限が予定日とずれているときだけ現在の期限を表示する", () => {
    const { unmount } = renderDetail(todo());
    expect(screen.queryByText("現在の期限")).not.toBeInTheDocument();
    unmount();

    renderDetail(todo({ dueAt: "2026-09-10T15:00:00.000Z" }));
    expect(screen.getByText("現在の期限")).toBeInTheDocument();
    expect(screen.getByText("2026年9月11日")).toBeInTheDocument();
  });

  it("完了日基準Todoでは推奨期間の上限として期限を表示する", () => {
    renderDetail(todo({
      dueAt: "2026-09-30T15:00:00.000Z",
      isMaintenance: true,
      recurrenceBasis: "completion",
    }));

    expect(screen.getByText("推奨期間の上限")).toBeInTheDocument();
    expect(screen.getByText("完了した日から繰り返す")).toBeInTheDocument();
  });

  it("繰り返しなしTodoからは編集画面へ移動でき、実施記録の修正は出さない", () => {
    renderDetail(todo());

    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/todos/occurrence-1/edit",
    );
    expect(screen.queryByRole("button", { name: /修正/u })).not.toBeInTheDocument();
  });

  it("繰り返しのあるTodoには編集導線を出さず、変更できない理由を示す", () => {
    renderDetail(todo({ recurrenceBasis: "calendar" }));

    expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/繰り返しのあるTodoの内容は、この画面からは変更できません。/u),
    ).toBeInTheDocument();
  });
});

describe("完了済みTodoの詳細(TodoDetailContent、Issue #205)", () => {
  it("完了状態と、現在有効な実施日・実施者を表示する", () => {
    renderDetail(completedTodo());

    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(screen.getByText("2026年9月4日")).toBeInTheDocument();
    expect(screen.getByText("たろう")).toBeInTheDocument();
    // 完了済みTodoでは担当ではなく実施者を示す。
    expect(screen.queryByText("担当")).not.toBeInTheDocument();
  });

  it("実施記録の修正から訂正と完了取消を選べる", () => {
    renderDetail(completedTodo());

    expect(
      screen.getByRole("heading", { name: "実施記録を修正" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "フィルターの申請を修正" }),
    ).toBeInTheDocument();
  });

  it("完了済みTodoの内容編集は出さない", () => {
    renderDetail(completedTodo());

    expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.queryByText(/繰り返しのあるTodoの内容は/u)).not.toBeInTheDocument();
  });

  it("管理対象に紐づかない完了済みTodoも同じ画面で扱える", () => {
    renderDetail(completedTodo({ managedItemId: null, managedItemName: null }));

    expect(screen.getByText("関連する管理対象なし")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "フィルターの申請を修正" }),
    ).toBeInTheDocument();
  });
});

describe("Todo詳細(TodoDetailPage、サーバーコンポーネント)", () => {
  it("現在の家庭のTodoを読み出し、担当者名を解決する", async () => {
    loadTodoDetailMock.mockResolvedValue(pendingRow({ assignee_user_id: "user-2" }));
    loadActorNameMock.mockResolvedValue("たろう");

    render(await TodoDetailPage({ params: Promise.resolve({ id: "occurrence-1" }) }));

    expect(loadTodoDetailMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      "occurrence-1",
    );
    expect(screen.getByRole("heading", { level: 1, name: "通知書が届いたら申請" }))
      .toBeInTheDocument();
    expect(screen.getByText("たろう")).toBeInTheDocument();
  });

  it("完了済みTodoでは訂正後の実施日時と実施者名を表示する(YDR-026)", async () => {
    loadTodoDetailMock.mockResolvedValue(pendingRow({
      completed_activity_log_id: "log-1",
      // 訂正済みの有効値がloadTodoDetailから返る。
      occurred_at: "2026-08-20T15:00:00.000Z",
      performed_by_user_id: "user-2",
      status: "completed",
    }));
    loadActorNameMock.mockResolvedValue("たろう");

    render(await TodoDetailPage({ params: Promise.resolve({ id: "occurrence-1" }) }));

    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(screen.getByText("2026年8月21日")).toBeInTheDocument();
    expect(screen.getByText("たろう")).toBeInTheDocument();
    expect(loadActorNameMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      "user-2",
      "メンバー",
    );
  });

  it("他家庭のTodoは見つからないものとして扱う", async () => {
    loadTodoDetailMock.mockResolvedValue(null);

    await expect(
      TodoDetailPage({ params: Promise.resolve({ id: "occurrence-x" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(loadActorNameMock).not.toHaveBeenCalled();
  });
});
