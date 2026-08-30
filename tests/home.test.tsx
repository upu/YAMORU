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

import { buildRecentItems, HomeContent, type HomeSection } from "../src/app/page";

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
    { description: "対応の目安の期間です", id: "reminder", items: overrides.reminder ?? [], title: "メンテナンス" },
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

    expect(screen.getByRole("region", { name: "メンテナンス" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "期限切れ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "今日" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "近日" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "最近の実施" })).not.toBeInTheDocument();
  });

  it("メンテナンス区分のTodoからTodo詳細・管理対象の詳細へ移動でき、対応状況の件数に反映される", () => {
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

    const reminderSection = screen.getByRole("region", { name: "メンテナンス" });
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

  it("メンテナンス区分のTodoに「やったよ」ボタンを表示し、押すとそのOccurrenceを完了操作する", () => {
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

    const reminderSection = screen.getByRole("region", { name: "メンテナンス" });
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
