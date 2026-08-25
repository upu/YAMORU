import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  completeMaintenanceTaskMock,
  setTaskOccurrenceAssigneeMock,
  setTaskOccurrenceScheduleMock,
} = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
  setTaskOccurrenceScheduleMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/[id]/actions", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
  setTaskOccurrenceSchedule: setTaskOccurrenceScheduleMock,
  unsetTaskOccurrenceSchedule: vi.fn(),
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import type { PendingOccurrenceRow } from "../src/lib/d1/home";
import { buildTodoListItems, TodoListContent } from "../src/app/todos/page";

const HOUSEHOLD = { id: "household-1", name: "テスト家庭" };
const ACTOR_NAME = "ぽっぷ";
const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];
// Tokyo 2026-08-12を「今日」とする時刻。
const NOW = "2026-08-12T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function onceRow(
  id: string,
  scheduledFor: string | null,
  title = "今回だけ点検",
): PendingOccurrenceRow {
  return {
    assignee_user_id: null,
    due_at: scheduledFor,
    id,
    scheduled_for: scheduledFor,
    task_rules: {
      deadline_kind: "strict",
      managed_items: { id: "item-1", name: "猫の浄水器" },
      recurrence_basis: "once",
      title,
    },
  };
}

function maintenanceRow(id: string, scheduledFor: string, dueAt: string): PendingOccurrenceRow {
  return {
    assignee_user_id: null,
    due_at: dueAt,
    id,
    scheduled_for: scheduledFor,
    task_rules: {
      deadline_kind: "maintenance",
      managed_items: { id: "item-1", name: "猫の浄水器" },
      recurrence_basis: "completion",
      title: "フィルター交換",
    },
  };
}

function renderTodoList(
  items: ReturnType<typeof buildTodoListItems>,
  household: typeof HOUSEHOLD | null = HOUSEHOLD,
) {
  return render(
    <TodoListContent
      actorName={ACTOR_NAME}
      currentUserId="user-1"
      household={household}
      items={items}
      members={MEMBERS}
    />,
  );
}

describe("未完了Todoの並び(buildTodoListItems)", () => {
  it("ホームに出ない7日より先の予定と推奨期間前のTodoも含める", () => {
    const items = buildTodoListItems(
      [
        onceRow("overdue", "2026-08-10T15:00:00.000Z", "期限切れの用事"),
        onceRow("later", "2026-09-30T15:00:00.000Z", "ずっと先の用事"),
        // scheduled_for(Tokyo 10/1)より前の「今日」は推奨期間前(YDR-017)。
        maintenanceRow("before-window", "2026-09-30T15:00:00.000Z", "2026-10-31T15:00:00.000Z"),
      ],
      NOW,
    );

    expect(items.map((item) => item.id)).toEqual(["overdue", "later", "before-window"]);
  });

  it("日付があるTodoを期限の昇順で並べ、予定日未定を末尾へ置く", () => {
    const items = buildTodoListItems(
      [
        onceRow("undated", null, "通知書が届いたら申請"),
        onceRow("later", "2026-09-30T15:00:00.000Z"),
        onceRow("today", "2026-08-11T15:00:00.000Z"),
      ],
      NOW,
    );

    expect(items.map((item) => item.id)).toEqual(["today", "later", "undated"]);
    expect(items[2].meta).toBe("予定日: 未定 ・ 繰り返しなし");
  });

  it("管理対象に紐づかないTodoもリンクなしで含める", () => {
    const row = onceRow("unlinked", "2026-08-11T15:00:00.000Z", "家族会議");
    row.task_rules.managed_items = null;

    const items = buildTodoListItems([row], NOW);

    expect(items[0]).toMatchObject({
      detail: "管理対象なし",
      managedItemId: null,
      occurrenceId: "unlinked",
      title: "家族会議",
    });
    expect(items[0].detailHref).toBeUndefined();
  });
});

describe("すべてのTodo画面(TodoListContent)", () => {
  it("見出しと件数、ホームへ戻る導線を表示する", () => {
    const items = buildTodoListItems(
      [onceRow("today", "2026-08-11T15:00:00.000Z"), onceRow("undated", null, "申請")],
      NOW,
    );
    renderTodoList(items);

    expect(screen.getByRole("heading", { level: 1, name: "すべてのTodo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← ホームへ戻る" })).toHaveAttribute("href", "/");
    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(within(section).getByLabelText("2件")).toBeInTheDocument();
    expect(within(section).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["今回だけ点検", "申請"]);
  });

  it("Todo名からTodo詳細へ、管理対象名から管理対象の詳細へ移動できる(Issue #203)", () => {
    renderTodoList(buildTodoListItems([onceRow("today", "2026-08-11T15:00:00.000Z")], NOW));

    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(within(section).getByRole("link", { name: "今回だけ点検" })).toHaveAttribute(
      "href",
      "/todos/today",
    );
    expect(within(section).getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
  });

  it("未完了Todoが0件のときは空表示と登録導線を出す", () => {
    renderTodoList([]);

    expect(
      screen.getByRole("heading", { name: "未完了のTodoはありません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "最初のTodoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );
    expect(screen.queryByRole("region", { name: "未完了のTodo" })).not.toBeInTheDocument();
  });

  it("家庭未所属の利用者には家庭作成を案内し、一覧も登録導線も出さない", () => {
    renderTodoList([], null);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/household",
    );
    expect(screen.queryByRole("link", { name: "Todoを追加" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "未完了のTodo" })).not.toBeInTheDocument();
  });

  it("一覧から担当変更・完了・予定日設定を利用できる", () => {
    const row = onceRow("undated-unlinked", null, "通知書が届いたら申請");
    row.task_rules.managed_items = null;
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });
    renderTodoList(buildTodoListItems([row], NOW));

    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(within(section).getByLabelText("通知書が届いたら申請の担当")).toBeInTheDocument();
    expect(
      within(section).getByRole("button", { name: "通知書が届いたら申請の予定日を設定する" }),
    ).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "通知書が届いたら申請を記録" }));
    fireEvent.click(within(section).getByRole("button", { name: "今、自分がやった" }));

    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId] = completeMaintenanceTaskMock.mock.calls[0] as [
      string | null,
      string,
    ];
    expect(managedItemId).toBeNull();
    expect(occurrenceId).toBe("undated-unlinked");
  });
});
