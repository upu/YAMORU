import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  loadActorNameMock,
  loadPendingTodoDetailMock,
  notFoundMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  loadActorNameMock: vi.fn(),
  loadPendingTodoDetailMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  loadPendingTodoDetail: loadPendingTodoDetailMock,
}));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  loadActorName: loadActorNameMock,
}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

import TodoDetailPage, {
  TodoDetailContent,
  type TodoDetailData,
} from "../src/app/todos/[id]/page";

function todo(overrides: Partial<TodoDetailData> = {}): TodoDetailData {
  return {
    assigneeName: null,
    dueAt: "2026-09-01T15:00:00.000Z",
    id: "occurrence-1",
    isMaintenance: false,
    managedItemId: "item-1",
    managedItemName: "猫の浄水器",
    recurrenceBasis: "once",
    scheduledFor: "2026-09-01T15:00:00.000Z",
    title: "フィルターの申請",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
});

afterEach(cleanup);

describe("Todo詳細(TodoDetailContent)", () => {
  it("Todo名、繰り返し方、関連する管理対象、担当、予定日を表示する", () => {
    render(<TodoDetailContent todo={todo({ assigneeName: "ぽっぷ" })} />);

    expect(screen.getByRole("heading", { level: 1, name: "フィルターの申請" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
    expect(screen.getByText("繰り返しなし")).toBeInTheDocument();
    expect(screen.getByText("ぽっぷ")).toBeInTheDocument();
    expect(screen.getByText("2026年9月2日")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← すべてのTodoへ戻る" })).toHaveAttribute(
      "href",
      "/todos",
    );
  });

  it("担当が未設定なら誰でも可、管理対象がなければ関連なしと表示する", () => {
    render(
      <TodoDetailContent
        todo={todo({ managedItemId: null, managedItemName: null })}
      />,
    );

    expect(screen.getByText("誰でも可")).toBeInTheDocument();
    expect(screen.getByText("関連する管理対象なし")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "猫の浄水器" })).not.toBeInTheDocument();
  });

  it("予定日未定のTodoは予定日を未定として表示する", () => {
    render(<TodoDetailContent todo={todo({ dueAt: null, scheduledFor: null })} />);

    expect(screen.getByText("未定")).toBeInTheDocument();
  });

  it("延期して期限が予定日とずれているときだけ現在の期限を表示する", () => {
    const { unmount } = render(<TodoDetailContent todo={todo()} />);
    expect(screen.queryByText("現在の期限")).not.toBeInTheDocument();
    unmount();

    render(<TodoDetailContent todo={todo({ dueAt: "2026-09-10T15:00:00.000Z" })} />);
    expect(screen.getByText("現在の期限")).toBeInTheDocument();
    expect(screen.getByText("2026年9月11日")).toBeInTheDocument();
  });

  it("完了日基準Todoでは推奨期間の上限として期限を表示する", () => {
    render(
      <TodoDetailContent
        todo={todo({
          dueAt: "2026-09-30T15:00:00.000Z",
          isMaintenance: true,
          recurrenceBasis: "completion",
        })}
      />,
    );

    expect(screen.getByText("推奨期間の上限")).toBeInTheDocument();
    expect(screen.getByText("完了した日から繰り返す")).toBeInTheDocument();
  });

  it("繰り返しなしTodoからは編集画面へ移動できる", () => {
    render(<TodoDetailContent todo={todo()} />);

    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/todos/occurrence-1/edit",
    );
  });

  it("繰り返しのあるTodoには編集導線を出さず、変更できない理由を示す", () => {
    render(<TodoDetailContent todo={todo({ recurrenceBasis: "calendar" })} />);

    expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/繰り返しのあるTodoの内容は、この画面からは変更できません。/u),
    ).toBeInTheDocument();
  });
});

describe("Todo詳細(TodoDetailPage、サーバーコンポーネント)", () => {
  it("現在の家庭のpending Todoだけを読み出し、担当者名を解決する", async () => {
    loadPendingTodoDetailMock.mockResolvedValue({
      assignee_user_id: "user-2",
      deadline_kind: "strict",
      due_at: "2026-09-01T15:00:00.000Z",
      id: "occurrence-1",
      managed_item_id: null,
      managed_item_name: null,
      recurrence_basis: "once",
      scheduled_for: "2026-09-01T15:00:00.000Z",
      title: "通知書が届いたら申請",
    });
    loadActorNameMock.mockResolvedValue("たろう");

    render(await TodoDetailPage({ params: Promise.resolve({ id: "occurrence-1" }) }));

    expect(loadPendingTodoDetailMock).toHaveBeenCalledWith(
      {},
      { userId: "user-1" },
      "occurrence-1",
    );
    expect(screen.getByRole("heading", { level: 1, name: "通知書が届いたら申請" }))
      .toBeInTheDocument();
    expect(screen.getByText("たろう")).toBeInTheDocument();
  });

  it("他家庭のTodoや完了済みTodoは見つからないものとして扱う", async () => {
    loadPendingTodoDetailMock.mockResolvedValue(null);

    await expect(
      TodoDetailPage({ params: Promise.resolve({ id: "occurrence-x" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(loadActorNameMock).not.toHaveBeenCalled();
  });
});
