import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  completeMaintenanceTaskMock,
  setTaskOccurrenceAssigneeMock,
  undoMaintenanceTaskCompletionMock,
} = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
  undoMaintenanceTaskCompletionMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
  undoMaintenanceTaskCompletion: undoMaintenanceTaskCompletionMock,
}));

import {
  buildReminderItems,
  buildRecentItems,
  buildStrictItems,
  HomeContent,
  type HomeSection,
  type PendingOccurrenceRow,
  type RecentCompletionRow,
} from "../app/page";

const HOUSEHOLD = { id: "household-1", name: "テスト家庭" };
const ACTOR_NAME = "ぽっぷ";
const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function emptySections(overrides: Partial<Record<HomeSection["id"], HomeSection["items"]>> = {}): HomeSection[] {
  return [
    { description: "期限を過ぎています", id: "overdue", items: overrides.overdue ?? [], title: "期限切れ" },
    { description: "今日確認したいこと", id: "today", items: overrides.today ?? [], title: "今日" },
    { description: "対応の目安の時期です", id: "reminder", items: overrides.reminder ?? [], title: "そろそろ" },
    { description: "これから7日間の予定", id: "upcoming", items: overrides.upcoming ?? [], title: "近日" },
    { description: "家族が完了したこと", id: "recent", items: overrides.recent ?? [], title: "最近の実施" },
  ];
}

function renderHome(sections: HomeSection[], household: typeof HOUSEHOLD | null = HOUSEHOLD) {
  return render(
    <HomeContent
      actorName={ACTOR_NAME}
      currentUserId="user-1"
      heroDateLabel="8月13日 木"
      household={household}
      members={MEMBERS}
      sections={sections}
    />,
  );
}

describe("ホーム画面(HomeContent)", () => {
  it("YAMORUの名前・タグライン・現在日付を表示する", () => {
    renderHome(emptySections());

    expect(screen.getByRole("heading", { level: 1, name: "YAMORU" })).toBeInTheDocument();
    expect(screen.getByText("暮らしの「いつだっけ？」をなくす。")).toBeInTheDocument();
    expect(screen.getByText("8月13日 木")).toBeInTheDocument();
  });

  it("右上からアカウント画面へ移動できる", () => {
    renderHome(emptySections());

    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("link", { name: "アカウントを開く" }),
    ).toHaveAttribute("href", "/account");
  });

  it("家庭未所属の利用者には家庭作成を案内する", () => {
    renderHome([], null);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.queryByRole("region", { name: "Todoを追加" })).not.toBeInTheDocument();
  });

  it("ホームではTodo登録フォームを表示せず、専用登録ページへのリンクだけを表示する", () => {
    renderHome(emptySections());

    expect(screen.queryByRole("region", { name: "Todoを追加" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );
  });

  it("家庭は存在するが表示できるTodo・履歴が0件のときは空状態と登録導線を表示する", () => {
    renderHome(emptySections());

    expect(
      screen.getByRole("heading", { name: "まだ表示できる予定がありません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家の台帳を開く" })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    expect(screen.getByRole("link", { name: "最初のTodoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );
    expect(screen.queryByRole("region", { name: "期限切れ" })).not.toBeInTheDocument();
  });

  it("0件の区分は表示せず、件数がある区分だけを表示する", () => {
    const sections = emptySections({
      reminder: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "occurrence-1",
          managedItemId: "item-1",
          meta: "9月4日までが推奨期間です",
          title: "フィルター交換",
          tone: "reminder",
        },
      ],
    });
    renderHome(sections);

    expect(screen.getByRole("region", { name: "そろそろ" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "期限切れ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "今日" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "近日" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "最近の実施" })).not.toBeInTheDocument();
  });

  it("そろそろ区分のTodoから管理対象の詳細へ移動でき、対応状況の件数に反映される", () => {
    const sections = emptySections({
      reminder: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "occurrence-1",
          managedItemId: "item-1",
          meta: "9月4日までが推奨期間です",
          title: "猫の浄水器のフィルター交換",
          tone: "reminder",
        },
      ],
    });
    renderHome(sections);

    const reminderSection = screen.getByRole("region", { name: "そろそろ" });
    const link = within(reminderSection).getByRole("link", {
      name: "猫の浄水器のフィルター交換",
    });
    expect(link).toHaveAttribute("href", "/managed-items/item-1");
    expect(within(reminderSection).getAllByText("そろそろ").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("1件の予定");
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("0件が期限切れ");
  });

});

describe("ホームのTodo操作", () => {

  it("そろそろ区分のTodoに「やったよ」ボタンを表示し、押すとそのOccurrenceを完了操作する", () => {
    const sections = emptySections({
      reminder: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "occurrence-1",
          managedItemId: "item-1",
          meta: "9月4日までが推奨期間です",
          title: "猫の浄水器のフィルター交換",
          tone: "reminder",
        },
      ],
    });
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });
    renderHome(sections);

    const reminderSection = screen.getByRole("region", { name: "そろそろ" });
    const completeButton = within(reminderSection).getByRole("button", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    fireEvent.click(completeButton);
    expect(within(reminderSection).getByText(`現在の日付・${ACTOR_NAME}で記録`)).toBeInTheDocument();

    fireEvent.click(
      within(reminderSection).getByRole("button", { name: "今、自分がやった" }),
    );

    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId] = completeMaintenanceTaskMock.mock.calls[0] as [
      string,
      string,
    ];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
  });

  it("管理対象なしのTodoもリンクなしで表示し、ホームから完了・バックデートできる", () => {
    const sections = emptySections({
      today: [
        {
          detail: "管理対象なし",
          id: "occurrence-unlinked",
          managedItemId: null,
          meta: "今日が予定日です ・ 繰り返しなし",
          occurrenceId: "occurrence-unlinked",
          title: "家族会議",
          tone: "today",
        },
      ],
    });
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });
    renderHome(sections);

    const todaySection = screen.getByRole("region", { name: "今日" });
    expect(within(todaySection).queryByRole("link", { name: "家族会議" })).not.toBeInTheDocument();
    fireEvent.click(within(todaySection).getByRole("button", { name: "家族会議を記録" }));
    fireEvent.click(within(todaySection).getByRole("button", { name: "詳しく記録する" }));
    fireEvent.change(within(todaySection).getByLabelText("実施日"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.click(within(todaySection).getByRole("button", { name: "この内容で記録する" }));

    expect(completeMaintenanceTaskMock).toHaveBeenCalledWith(
      null,
      "occurrence-unlinked",
      expect.any(String),
      "2026-08-10",
      "user-1",
    );
  });

  it("管理対象なしの完了もホームから取り消せる", () => {
    const sections = emptySections({
      recent: [
        {
          completedAt: "2026-08-10T00:00:00.000Z",
          completedOccurrenceId: "occurrence-unlinked",
          detail: "管理対象なし",
          id: "activity-unlinked",
          managedItemId: null,
          meta: "8月10日 ・ ぽっぷが実施",
          title: "家族会議",
          tone: "done",
        },
      ],
    });
    undoMaintenanceTaskCompletionMock.mockResolvedValue({
      message: "完了の取消を記録しました。",
      status: "success",
    });
    renderHome(sections);

    fireEvent.click(screen.getByRole("button", { name: "家族会議の完了を取り消す" }));
    fireEvent.click(screen.getByRole("button", { name: "この完了を取り消す" }));

    expect(undoMaintenanceTaskCompletionMock).toHaveBeenCalledWith(
      null,
      "occurrence-unlinked",
      expect.any(String),
    );
  });

  it("最近の実施区分に実施日と実施者名を表示し、「やったよ」ボタンは表示しない", () => {
    const sections = emptySections({
      recent: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "activity-1",
          meta: "8月10日 ・ たろうが実施",
          title: "フィルター交換",
          tone: "done",
        },
      ],
    });
    renderHome(sections);

    const recentSection = screen.getByRole("region", { name: "最近の実施" });
    expect(within(recentSection).getByText("8月10日 ・ たろうが実施")).toBeInTheDocument();
    expect(within(recentSection).queryByRole("button")).not.toBeInTheDocument();
    // 完了済みは対応状況の「件の予定」には数えない。
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("0件の予定");
  });
});

describe("推奨期間による分類(buildReminderItems, YDR-017)", () => {
  function pendingRow(overrides: Partial<PendingOccurrenceRow> = {}): PendingOccurrenceRow {
    return {
      assignee_user_id: null,
      due_at: "2026-09-04T15:00:00.000Z",
      id: "occurrence-1",
      scheduled_for: "2026-08-06T15:00:00.000Z",
      task_rules: {
        deadline_kind: "maintenance",
        managed_items: { id: "item-1", name: "猫の浄水器" },
        recurrence_basis: "completion",
        title: "フィルター交換",
      },
      ...overrides,
    };
  }

  it("推奨期間前は表示しない", () => {
    const items = buildReminderItems([pendingRow()], "2026-08-01T00:00:00.000Z");
    expect(items).toHaveLength(0);
  });

  it("推奨期間内はreminderトーンで推奨期間の上限を案内し、完了操作用のmanagedItemIdを持つ", () => {
    const items = buildReminderItems([pendingRow()], "2026-08-12T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      detail: "猫の浄水器",
      detailHref: "/managed-items/item-1",
      managedItemId: "item-1",
      title: "フィルター交換",
      tone: "reminder",
    });
    expect(items[0].meta).toBe("9月5日までが推奨期間です");
  });

  it("推奨期間の上限超過はcautionトーンで責めずに案内する", () => {
    const items = buildReminderItems([pendingRow()], "2026-09-10T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0].tone).toBe("caution");
    expect(items[0].meta).toBe("9月5日に推奨期間の上限を過ぎました");
  });

  it("due_atの昇順で並べる", () => {
    const items = buildReminderItems(
      [
        pendingRow({ due_at: "2026-09-10T15:00:00.000Z", id: "later" }),
        pendingRow({ due_at: "2026-08-20T15:00:00.000Z", id: "earlier" }),
      ],
      "2026-08-12T00:00:00.000Z",
    );
    expect(items.map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("未知のdeadline_kindは黙って無視せず例外にする", () => {
    expect(() =>
      buildReminderItems(
        [pendingRow({ task_rules: { ...pendingRow().task_rules, deadline_kind: "strict" } })],
        "2026-08-12T00:00:00.000Z",
      ),
    ).toThrow();
  });
});

describe("一回限りTodoの分類(buildStrictItems)", () => {
  function onceRow(
    id: string,
    scheduledFor: string,
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
        title: "今回だけ点検",
      },
    };
  }

  it("予定日を期限切れ・今日・近日へ分け、遠い予定はホームへ出さない", () => {
    const items = buildStrictItems(
      [
        onceRow("overdue", "2026-08-10T15:00:00.000Z"),
        onceRow("today", "2026-08-11T15:00:00.000Z"),
        onceRow("upcoming", "2026-08-14T15:00:00.000Z"),
        onceRow("later", "2026-08-29T15:00:00.000Z"),
      ],
      "2026-08-12T00:00:00.000Z",
    );

    expect(items.overdue.map((item) => item.id)).toEqual(["overdue"]);
    expect(items.today.map((item) => item.id)).toEqual(["today"]);
    expect(items.upcoming.map((item) => item.id)).toEqual(["upcoming"]);
    expect(items.upcoming[0].meta).toBe("8月15日の予定です ・ 繰り返しなし");
  });

  it("管理対象なしでも同じ日付基準で分類し、ホーム操作用のOccurrenceを保持する", () => {
    const row = onceRow("unlinked", "2026-08-11T15:00:00.000Z");
    row.task_rules.managed_items = null;

    const items = buildStrictItems([row], "2026-08-12T00:00:00.000Z");

    expect(items.today[0]).toMatchObject({
      detail: "管理対象なし",
      managedItemId: null,
      occurrenceId: "unlinked",
      title: "今回だけ点検",
    });
    expect(items.today[0].detailHref).toBeUndefined();
  });

  it("定例日基準Todoをstrict日付で分類し、繰り返し方式を見分けられる", () => {
    const row = onceRow("calendar", "2026-08-14T15:00:00.000Z");
    row.task_rules.recurrence_basis = "calendar";
    row.task_rules.title = "毎週の家族会議";

    const items = buildStrictItems([row], "2026-08-12T00:00:00.000Z");

    expect(items.upcoming[0]).toMatchObject({
      meta: "8月15日の予定です ・ 曜日・日付で繰り返す",
      title: "毎週の家族会議",
    });
  });
});

describe("最近の実施の組み立て(buildRecentItems)", () => {
  function completionRow(overrides: Partial<RecentCompletionRow> = {}): RecentCompletionRow {
    return {
      id: "activity-1",
      occurred_at: "2026-08-10T00:00:00.000Z",
      performed_by_user_id: "user-1",
      task_occurrences: {
        id: "occurrence-1",
        status: "completed",
        task_rules: {
          managed_items: { id: "item-1", name: "猫の浄水器" },
          title: "フィルター交換",
        },
      },
      ...overrides,
    };
  }

  it("実施者名を解決し、ホームからの完了取消に必要な情報を保持する", () => {
    const items = buildRecentItems(
      [completionRow()],
      new Map([["user-1", "たろう"]]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].meta).toContain("たろうが実施");
    expect(items[0].tone).toBe("done");
    expect(items[0]).toMatchObject({
      completedAt: "2026-08-10T00:00:00.000Z",
      completedOccurrenceId: "occurrence-1",
      managedItemId: "item-1",
    });
  });

  it("実施者名が解決できない場合はフォールバック表示にする", () => {
    const items = buildRecentItems([completionRow()], new Map());
    expect(items[0].meta).toContain("メンバーが実施");
  });

  it("performed_by_user_idがnullの場合もフォールバック表示にする(型上のnull許容への防御)", () => {
    const items = buildRecentItems(
      [completionRow({ performed_by_user_id: null })],
      new Map([["user-1", "たろう"]]),
    );
    expect(items[0].meta).toContain("メンバーが実施");
  });

  it("Occurrenceの状態がcompleted以外(取消後を想定)なら除外する", () => {
    const items = buildRecentItems(
      [
        completionRow({
          task_occurrences: { ...completionRow().task_occurrences, status: "pending" },
        }),
      ],
      new Map(),
    );
    expect(items).toHaveLength(0);
  });

  it("管理対象なしの完了履歴も表示し、取消に必要なOccurrence情報を保持する", () => {
    const row = completionRow();
    row.task_occurrences.task_rules.managed_items = null;

    const items = buildRecentItems([row], new Map([["user-1", "たろう"]]));

    expect(items[0]).toMatchObject({
      completedAt: "2026-08-10T00:00:00.000Z",
      completedOccurrenceId: "occurrence-1",
      detail: "管理対象なし",
      managedItemId: null,
    });
    expect(items[0].detailHref).toBeUndefined();
  });
});
