import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  completeMaintenanceTaskMock,
  correctCompletionOccurredAtMock,
  correctCompletionPerformerMock,
  setTaskOccurrenceAssigneeMock,
  undoMaintenanceTaskCompletionMock,
} = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
  correctCompletionOccurredAtMock: vi.fn(),
  correctCompletionPerformerMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
  undoMaintenanceTaskCompletionMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/[id]/actions", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
  correctCompletionOccurredAt: correctCompletionOccurredAtMock,
  correctCompletionPerformer: correctCompletionPerformerMock,
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
  undoMaintenanceTaskCompletion: undoMaintenanceTaskCompletionMock,
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import {
  buildPendingSectionItems,
  buildRecentItems,
  HomeContent,
  type HomeSection,
  type PendingOccurrenceRow,
  type RecentCompletionRow,
} from "../src/app/page";

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
      household={household}
      members={MEMBERS}
      sections={sections}
    />,
  );
}

describe("ホーム画面(HomeContent)", () => {
  it("ブランド紹介を省き、ホーム見出しと主要な導線・対応状況を維持する", () => {
    renderHome(emptySections());

    expect(screen.getByRole("heading", { level: 1, name: "ホーム" })).toHaveClass("sr-only");
    expect(screen.queryByText("HOME CARE")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "YAMORU" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("暮らしの「いつだっけ？」をなくす。"))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Todoを追加" })).toHaveClass(
      "floating-add-button",
    );
    expect(screen.getByRole("link", { name: "家の台帳" })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    expect(screen.getByLabelText("対応状況")).toBeInTheDocument();
    expect(document.querySelector(".brand-row")).not.toBeInTheDocument();
    expect(document.querySelector(".date-badge")).not.toBeInTheDocument();
  });

  it("ページ固有のアカウント導線を表示しない", () => {
    renderHome(emptySections());

    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("link", { name: "アカウントを開く" }))
      .not.toBeInTheDocument();
  });

  it("家庭未所属の利用者には家庭作成を案内する", () => {
    renderHome([], null);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/household",
    );
    expect(screen.queryByRole("region", { name: "Todoを追加" })).not.toBeInTheDocument();
  });

  it("ホームではTodo登録フォームを表示せず、右下の共通追加ボタンだけを表示する", () => {
    renderHome(emptySections());

    expect(screen.queryByRole("region", { name: "Todoを追加" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );
    expect(screen.getAllByRole("link", { name: /Todoを追加/u })).toHaveLength(1);
  });

  it("Todo一覧へのPC向け導線を表示し、モバイルではタブと重複しない印を付ける", () => {
    renderHome(emptySections());

    expect(screen.getByRole("link", { name: "Todo一覧" })).toHaveAttribute(
      "href",
      "/todos",
    );
    expect(screen.getByRole("link", { name: "Todo一覧" })).toHaveClass(
      "home-todo-list-link",
    );
  });

  it("家庭未所属の利用者にはTodo関連の導線を表示しない", () => {
    renderHome([], null);

    expect(screen.queryByRole("link", { name: "Todo一覧" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Todoを追加" })).not.toBeInTheDocument();
  });

  it("家庭は存在するが表示できるTodo・履歴が0件のときは空状態と登録導線を表示する", () => {
    renderHome(emptySections());

    expect(
      screen.getByRole("heading", { name: "いま対応することはありません" }),
    ).toBeInTheDocument();
    // Issue #202: ホームが空でも予定日未定Todoは残りうるため、再発見経路を示す。
    expect(screen.getByRole("link", { name: "Todo一覧を見る" })).toHaveAttribute(
      "href",
      "/todos",
    );
    expect(screen.getByRole("link", { name: "Todo一覧を見る" })).toHaveClass(
      "home-todo-list-link",
    );
    expect(screen.getByText(/予定日が決まっていないTodoはTodo一覧で確認できます。/u))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家の台帳を開く" })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    expect(screen.queryByRole("link", { name: "最初のTodoを追加" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
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
          occurrenceId: "occurrence-1",
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

  it("そろそろ区分のTodoからTodo詳細・管理対象の詳細へ移動でき、対応状況の件数に反映される", () => {
    const sections = emptySections({
      reminder: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "occurrence-1",
          managedItemId: "item-1",
          meta: "9月4日までが推奨期間です",
          occurrenceId: "occurrence-1",
          title: "猫の浄水器のフィルター交換",
          todoHref: "/todos/occurrence-1",
          tone: "reminder",
        },
      ],
    });
    renderHome(sections);

    const reminderSection = screen.getByRole("region", { name: "そろそろ" });
    // Issue #203: Todo名はTodo詳細、管理対象名は管理対象の詳細へ移動する。
    expect(
      within(reminderSection).getByRole("link", { name: "猫の浄水器のフィルター交換" }),
    ).toHaveAttribute("href", "/todos/occurrence-1");
    expect(
      within(reminderSection).getByRole("link", { name: "猫の浄水器" }),
    ).toHaveAttribute("href", "/managed-items/item-1");
    expect(within(reminderSection).getAllByText("そろそろ").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("1件の予定");
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("0件が期限切れ");
  });

});

describe("ホームのTodo操作", () => {

  it("予定日の設定・未定化はホームのカードに出さず、担当変更と完了は残す(Issue #204)", () => {
    renderHome(emptySections({
      today: [
        {
          assigneeUserId: null,
          detail: "管理対象なし",
          id: "dated",
          managedItemId: null,
          meta: "今日が予定日です ・ 繰り返しなし",
          occurrenceId: "dated",
          // 具体日がある一回限りTodo。以前はここに「予定日を未定に戻す」が出ていた。
          title: "家族会議",
          todoHref: "/todos/dated",
          tone: "today",
        },
      ],
    }));

    expect(screen.queryByRole("button", { name: "家族会議の予定日を未定に戻す" }))
      .not.toBeInTheDocument();
    // 確認と完了のための操作は維持する。
    expect(screen.getByLabelText("家族会議の担当")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "家族会議を記録" })).toBeInTheDocument();
    // 予定日の変更はTodo詳細から行う。
    expect(screen.getByRole("link", { name: "家族会議" })).toHaveAttribute(
      "href",
      "/todos/dated",
    );
  });

  it("そろそろ区分のTodoに「やったよ」ボタンを表示し、押すとそのOccurrenceを完了操作する", () => {
    const sections = emptySections({
      reminder: [
        {
          detail: "猫の浄水器",
          detailHref: "/managed-items/item-1",
          id: "occurrence-1",
          managedItemId: "item-1",
          meta: "9月4日までが推奨期間です",
          occurrenceId: "occurrence-1",
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

  it("管理対象なしの完了もホームから完了済みTodo詳細へ移動できる", () => {
    const sections = emptySections({
      recent: [
        {
          detail: "管理対象なし",
          id: "activity-unlinked",
          managedItemId: null,
          meta: "8月10日 ・ ぽっぷが実施",
          title: "家族会議",
          todoHref: "/todos/occurrence-unlinked",
          tone: "done",
        },
      ],
    });
    renderHome(sections);

    expect(screen.getByRole("link", { name: "家族会議" })).toHaveAttribute(
      "href",
      "/todos/occurrence-unlinked",
    );
    expect(screen.queryByRole("button", { name: "家族会議を修正" }))
      .not.toBeInTheDocument();
  });

  it("実際の最近の実施データは確認情報を保ち、Todo詳細への導線だけを表示する", () => {
    const recentItems = buildRecentItems(
      [
        {
          activity_log_id: "activity-1",
          managed_item_id: "item-1",
          managed_item_name: "猫の浄水器",
          occurred_at: "2026-08-10T00:00:00.000Z",
          performed_by_user_id: "user-2",
          task_occurrence_id: "occurrence-1",
          task_rule_title: "フィルター交換",
        },
      ],
      new Map([["user-2", "たろう"]]),
    );
    const sections = emptySections({ recent: recentItems });
    renderHome(sections);

    const recentSection = screen.getByRole("region", { name: "最近の実施" });
    expect(
      within(recentSection).getByText("2026年8月10日 ・ たろうが実施"),
    ).toBeInTheDocument();
    expect(within(recentSection).queryByLabelText("フィルター交換の担当")).not.toBeInTheDocument();
    expect(
      within(recentSection).queryByRole("button", { name: "フィルター交換を記録" }),
    ).not.toBeInTheDocument();
    expect(
      within(recentSection).queryByRole("button", { name: "フィルター交換を修正" }),
    ).not.toBeInTheDocument();
    expect(
      within(recentSection).getByRole("link", { name: "フィルター交換" }),
    ).toHaveAttribute("href", "/todos/occurrence-1");
    expect(
      within(recentSection).getByRole("link", { name: "猫の浄水器" }),
    ).toHaveAttribute("href", "/managed-items/item-1");
    // 完了済みは対応状況の「件の予定」には数えない。
    expect(screen.getByLabelText("対応状況")).toHaveTextContent("0件の予定");
  });
});

describe("推奨期間による分類(buildPendingSectionItems, YDR-017)", () => {
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

  function buildReminderItems(rows: PendingOccurrenceRow[], nowIso: string) {
    return buildPendingSectionItems(rows, nowIso).reminder;
  }

  it("推奨期間前はホームに表示しない(Todo一覧で確認する)", () => {
    const items = buildReminderItems([pendingRow()], "2026-08-01T00:00:00.000Z");
    expect(items).toHaveLength(0);
  });

  it("推奨期間内はreminderトーンで推奨期間の上限を案内し、完了操作用のmanagedItemIdを持つ", () => {
    // scheduled_for(Tokyo 8/7)〜due_at(Tokyo 9/5)の80%しきい値はTokyo 8/31
    // (Issue #52)。9/1はしきい値を過ぎ、上限日より前。
    const items = buildReminderItems([pendingRow()], "2026-09-01T00:00:00.000Z");
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
    // どちらも80%しきい値(Issue #52)を過ぎているnowを使う。earlierは
    // 上限日も過ぎてpast-windowになるが、before-windowでなければ表示は
    // 維持される。
    const items = buildReminderItems(
      [
        pendingRow({ due_at: "2026-09-10T15:00:00.000Z", id: "later" }),
        pendingRow({ due_at: "2026-08-20T15:00:00.000Z", id: "earlier" }),
      ],
      "2026-09-05T00:00:00.000Z",
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

describe("一回限りTodoの分類(buildPendingSectionItems)", () => {
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
    const items = buildPendingSectionItems(
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

  it("予定日未定Todoはホームのどの区分にも入れない(Issue #202、YDR-031)", () => {
    const undatedRow = onceRow("undated", "2026-08-11T15:00:00.000Z");
    undatedRow.scheduled_for = null;
    undatedRow.due_at = null;

    const items = buildPendingSectionItems(
      [undatedRow, onceRow("today", "2026-08-11T15:00:00.000Z")],
      "2026-08-12T00:00:00.000Z",
    );

    expect(items.today.map((item) => item.id)).toEqual(["today"]);
    expect(items.overdue).toHaveLength(0);
    expect(items.upcoming).toHaveLength(0);
    expect(items.reminder).toHaveLength(0);
    expect(Object.values(items).flat().map((item) => item.id)).not.toContain("undated");
  });

  it("予定日を設定したTodoは日付に応じてホームへ戻る(Issue #202)", () => {
    const scheduled = onceRow("undated", "2026-08-14T15:00:00.000Z");

    const items = buildPendingSectionItems([scheduled], "2026-08-12T00:00:00.000Z");

    expect(items.upcoming.map((item) => item.id)).toEqual(["undated"]);
  });

  it("管理対象なしでも同じ日付基準で分類し、ホーム操作用のOccurrenceを保持する", () => {
    const row = onceRow("unlinked", "2026-08-11T15:00:00.000Z");
    row.task_rules.managed_items = null;

    const items = buildPendingSectionItems([row], "2026-08-12T00:00:00.000Z");

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

    const items = buildPendingSectionItems([row], "2026-08-12T00:00:00.000Z");

    expect(items.upcoming[0]).toMatchObject({
      meta: "8月15日の予定です ・ 曜日・日付で繰り返す",
      title: "毎週の家族会議",
    });
  });
});

describe("最近の実施の組み立て(buildRecentItems)", () => {
  function completionRow(overrides: Partial<RecentCompletionRow> = {}): RecentCompletionRow {
    return {
      activity_log_id: "activity-1",
      managed_item_id: "item-1",
      managed_item_name: "猫の浄水器",
      occurred_at: "2026-08-10T00:00:00.000Z",
      performed_by_user_id: "user-1",
      task_occurrence_id: "occurrence-1",
      task_rule_title: "フィルター交換",
      ...overrides,
    };
  }

  it("実施者名を解決し、完了済みTodo詳細への導線を保持する", () => {
    const items = buildRecentItems(
      [completionRow()],
      new Map([["user-1", "たろう"]]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].meta).toContain("たろうが実施");
    expect(items[0].tone).toBe("done");
    expect(items[0]).toMatchObject({
      managedItemId: "item-1",
      todoHref: "/todos/occurrence-1",
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

  it("取消後に再完了したOccurrenceは最新の完了だけを表示する", () => {
    const latest = completionRow({
      activity_log_id: "activity-latest",
      occurred_at: "2026-08-09T00:00:00.000Z",
    });
    const cancelled = completionRow({
      activity_log_id: "activity-cancelled",
      occurred_at: "2026-08-10T00:00:00.000Z",
    });

    const items = buildRecentItems([latest, cancelled], new Map());

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "activity-latest",
    });
  });

  it("管理対象なしの完了履歴も表示し、Todo詳細への導線を保持する", () => {
    const row = completionRow();
    row.managed_item_id = null;
    row.managed_item_name = null;

    const items = buildRecentItems([row], new Map([["user-1", "たろう"]]));

    expect(items[0]).toMatchObject({
      detail: "管理対象なし",
      managedItemId: null,
      todoHref: "/todos/occurrence-1",
    });
    expect(items[0].detailHref).toBeUndefined();
  });
});
