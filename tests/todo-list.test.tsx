import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAssigneeToggle } from "./support/assignee-toggle";

const {
  completeMaintenanceTaskMock,
  setTaskOccurrenceAssigneeMock,
  setTaskOccurrenceScheduleMock,
} = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
  setTaskOccurrenceScheduleMock: vi.fn(),
}));

vi.mock("../src/features/todos/actions/assignee", () => ({
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
}));
vi.mock("../src/features/todos/actions/completion", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
}));
vi.mock("../src/features/todos/actions/schedule", () => ({
  setTaskOccurrenceSchedule: setTaskOccurrenceScheduleMock,
  unsetTaskOccurrenceSchedule: vi.fn(),
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import type { PendingOccurrenceRow } from "../src/lib/d1/home";
import { buildTodoListItems, TodoListContent } from "../src/app/todos/page";
import todoListStyles from "../src/app/todos/todo-list.module.css";

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

// Issue #325 / YDR-046: 「必要になったら繰り返す」Todoは常に予定日未定。
function manualRow(id: string, title = "コーヒーマシーンの石灰除去"): PendingOccurrenceRow {
  return {
    assignee_user_id: null,
    due_at: null,
    id,
    scheduled_for: null,
    task_rules: {
      deadline_kind: "strict",
      managed_items: { id: "item-1", name: "コーヒーマシーン" },
      recurrence_basis: "manual",
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
  viewParam: "card" | "list" = "card",
) {
  return render(
    <TodoListContent
      actorName={ACTOR_NAME}
      currentUserId="user-1"
      household={household}
      items={items}
      members={MEMBERS}
      viewParam={viewParam}
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
    // Issue #267: バッジの「未定」ですでに意味が伝わるため、metaの文章は
    // 重ねて出さない(TodoCardは空文字のmetaを描画しない)。
    expect(items[2].meta).toBe("");
  });

  // Issue #325 / YDR-046
  it("必要になったら繰り返すTodoも予定日未定として末尾に含め、「未定」と区別する", () => {
    const items = buildTodoListItems(
      [
        manualRow("manual"),
        onceRow("undated", null, "通知書が届いたら申請"),
        onceRow("today", "2026-08-11T15:00:00.000Z"),
      ],
      NOW,
    );

    expect(items.map((item) => item.id)).toEqual(["today", "manual", "undated"]);
    const manual = items.find((item) => item.id === "manual");
    expect(manual?.badge).toBe("必要時");
    // バッジだけでは繰り返すことが伝わらないため、繰り返し方だけを添える。
    expect(manual?.meta).toBe("必要になったら繰り返す");
    expect(items.find((item) => item.id === "undated")?.badge).toBe("未定");
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

  it.each([
    ["推奨期間前", "2026-09-10T00:00:00.000Z", "予定"],
    ["推奨期間中", "2026-09-13T00:00:00.000Z", "推奨期間"],
    ["後半", "2026-09-15T00:00:00.000Z", "そろそろ"],
    ["上限超過後", "2026-09-16T00:00:00.000Z", "推奨期間超過"],
  ])("%sでもリスト用の推奨期間は開始日と上限日の両方を保持する", (_label, nowIso, badge) => {
    const [item] = buildTodoListItems([
      maintenanceRow(
        "maintenance",
        "2026-09-12T00:00:00.000Z",
        "2026-09-15T00:00:00.000Z",
      ),
    ], nowIso);

    expect(item.listSchedule).toEqual({
      fromIso: "2026-09-12T00:00:00.000Z",
      kind: "range",
      untilIso: "2026-09-15T00:00:00.000Z",
    });
    expect(item.badge).toBe(badge);
  });
});

describe("Todo一覧画面(TodoListContent)", () => {
  it("簡潔な見出しと件数を表示し、ホームへ戻る導線は置かない", () => {
    const items = buildTodoListItems(
      [onceRow("today", "2026-08-11T15:00:00.000Z"), onceRow("undated", null, "申請")],
      NOW,
    );
    renderTodoList(items);

    expect(screen.getByRole("heading", { level: 1, name: "Todo一覧" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "← ホームへ戻る" })).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(within(section).getByLabelText("2件")).toBeInTheDocument();
    expect(within(section).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["今回だけ点検", "申請"]);
  });

  // Issue #241: 状態切り替え・検索の入り口を一つのツールバーへまとめ、
  // 状態によって切り替わる説明文や英字キッカー、一覧側の重複する状態見出しは
  // 画面上に出さない。
  it("状態によって切り替わる説明文やキッカー、一覧側の重複する状態見出しを画面上に出さない", () => {
    renderTodoList(buildTodoListItems([onceRow("today", "2026-08-11T15:00:00.000Z")], NOW));

    expect(screen.queryByText("未完了のTodoをまとめて確認できます。")).not.toBeInTheDocument();
    expect(screen.queryByText("ALL TODOS")).not.toBeInTheDocument();

    // 一覧領域の意味は支援技術向けに残すが、画面上の見出しとしては出さない
    // (Issue #237の台帳一覧と同じ考え方)。
    const listHeading = screen.getByRole("heading", { level: 2, name: "未完了のTodo" });
    expect(listHeading).toHaveClass("sr-only");
    expect(screen.getByRole("region", { name: "未完了のTodo" })).toBeInTheDocument();
  });

  // Issue #241: 状態の2択は常に両方の選択肢が見えるコンパクトな切り替えとして
  // ツールバーへ置く(案1)。
  it("現在の状態が分かり、未完了/実施済みを常に選べるツールバーの状態切り替えを表示する", () => {
    renderTodoList([]);

    expect(screen.getByRole("link", { name: "未完了" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "実施済み" })).not.toHaveAttribute("aria-current");
  });

  // Issue #266: 担当条件と表示形式は、一覧の縦幅を増やす独立した行ではなく
  // 見出し横のツールバーへまとめる。担当候補は閉じた選択UIに収め、表示形式は
  // 一般的なグリッド/リストアイコンで表す。
  // Issue #390: そのまとめ方を、絞り込み(状態・担当)とそれ以外の操作
  // (追加・表示形式)の2つのまとまりに分ける。狭い幅で折り返す位置を
  // まとまりの境目に固定し、単独の操作が次行へ取り残されないようにする
  // (実際の行の並びはe2e/todo-list-compact-layout.spec.tsで確認する)。
  it("担当絞り込みとアイコンの表示切り替えをツールバー内へコンパクトにまとめる", () => {
    renderTodoList([]);

    const toolbarFilters = document.querySelector(`.${todoListStyles.toolbarFilters}`);
    const toolbarActions = document.querySelector(`.${todoListStyles.toolbarActions}`);
    const assigneeToggle = getAssigneeToggle("担当: 全員");
    const assigneeDisclosure = assigneeToggle.closest("details");
    const statusSwitch = screen.getByRole("link", { name: "未完了" });
    const cardSwitch = screen.getByRole("link", { name: "カード表示" });
    const listSwitch = screen.getByRole("link", { name: "リスト表示" });

    expect(toolbarFilters).toContainElement(statusSwitch);
    expect(toolbarFilters).toContainElement(assigneeDisclosure);
    expect(toolbarActions).toContainElement(cardSwitch);
    expect(toolbarActions).toContainElement(listSwitch);
    expect(toolbarActions).not.toContainElement(assigneeDisclosure);
    expect(assigneeDisclosure).not.toHaveAttribute("open");
    expect(cardSwitch.querySelector("svg")).toBeInTheDocument();
    expect(listSwitch.querySelector("svg")).toBeInTheDocument();
    expect(document.querySelector(".assignee-filter")).not.toBeInTheDocument();
    expect(document.querySelector(".view-switch")).not.toBeInTheDocument();
  });

  // Issue #390: 検索は開くとツールバーの全幅を使うため、他の操作と同じ
  // まとまりには入れず、ツールバー直下へ置く。
  it("Todo内検索を表示形式の操作群の外側へ置き、開いたときに他の操作を押し出さない", () => {
    renderTodoList([]);

    const searchToggle = document.querySelector(`.${todoListStyles.searchToggle}`);
    const searchDisclosure = searchToggle?.closest("details");
    const toolbar = document.querySelector(`.${todoListStyles.toolbar}`);
    const toolbarActions = document.querySelector(`.${todoListStyles.toolbarActions}`);

    expect(toolbar).toContainElement(searchDisclosure ?? null);
    expect(toolbarActions).not.toContainElement(searchDisclosure ?? null);
    expect(searchDisclosure?.parentElement).toBe(toolbar);
  });

  // Issue #241: 虫眼鏡から開くTodo内検索。検索語が適用中でなければ既定で
  // 閉じておき、押すと展開できる(<details>のネイティブな開閉状態)。
  it("虫眼鏡ボタンからTodo内検索を開ける入り口を表示し、検索語がなければ閉じておく", () => {
    renderTodoList([]);

    const searchToggle = document.querySelector(`.${todoListStyles.searchToggle}`);
    expect(searchToggle).toHaveAttribute("aria-label", "Todoを検索");
    const disclosure = searchToggle?.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByRole("searchbox", { name: "Todo名で検索" })).toBeInTheDocument();
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

  it("未完了Todoが0件のときも右下の共通追加ボタンから登録できる", () => {
    renderTodoList([]);

    expect(
      screen.getByRole("heading", { name: "未完了のTodoはありません" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "最初のTodoを追加" }))
      .not.toBeInTheDocument();
    // Issue #391: ツールバーの中のリンクと右下のボタンが同じ文言・同じ行き先を
    // 持ち、表示は画面幅ごとにどちらか一方だけになる(切り替えはCSSで行う)。
    const addLinks = screen.getAllByRole("link", { name: "Todoを追加" });
    expect(addLinks).toHaveLength(2);
    for (const addLink of addLinks) {
      expect(addLink).toHaveAttribute("href", "/todos/new");
    }
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

  it("リスト表示では推奨期間全体と担当者未設定を区別して表示する", () => {
    const items = buildTodoListItems([
      maintenanceRow(
        "maintenance",
        "2026-09-12T00:00:00.000Z",
        "2026-09-15T00:00:00.000Z",
      ),
    ], "2026-09-13T00:00:00.000Z");
    renderTodoList(items, HOUSEHOLD, "list");

    const rowLink = screen.getByRole("link", { name: /フィルター交換/ });
    const meta = rowLink.querySelector(`.${todoListStyles.rowMeta}`);
    expect(meta).toHaveTextContent("9/12〜9/15");
    expect(meta).toHaveTextContent("誰でも可");
    expect(rowLink).toHaveTextContent("推奨期間");
  });

  it("予定日未定のリスト表示では日付の未定と担当者未設定を混同させない", () => {
    renderTodoList(buildTodoListItems([onceRow("undated", null)], NOW), HOUSEHOLD, "list");

    const rowLink = screen.getByRole("link", { name: /今回だけ点検/ });
    expect(rowLink.querySelector(`.${todoListStyles.rowMeta}`)).toHaveTextContent("誰でも可");
    expect(rowLink.querySelector(`.${todoListStyles.rowMeta}`)).not.toHaveTextContent("未定");
    expect(rowLink.querySelector(".tone-label")).toHaveTextContent("未定");
  });

  it("一覧から担当変更・完了を利用できる", () => {
    const row = onceRow("undated-unlinked", null, "通知書が届いたら申請");
    row.task_rules.managed_items = null;
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });
    renderTodoList(buildTodoListItems([row], NOW));

    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(within(section).getByLabelText("通知書が届いたら申請の担当")).toBeInTheDocument();

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

  // Issue #267: 予定日未定カードから「予定日を設定」を外し、Todo名から
  // Todo詳細を開いた編集画面で予定日を設定する流れへそろえる。
  it("予定日未定カードに「予定日を設定」を出さず、Todo名からTodo詳細へ移動できる", () => {
    const row = onceRow("undated-unlinked", null, "通知書が届いたら申請");
    row.task_rules.managed_items = null;
    renderTodoList(buildTodoListItems([row], NOW));

    const section = screen.getByRole("region", { name: "未完了のTodo" });
    expect(
      within(section).queryByRole("button", { name: "通知書が届いたら申請の予定日を設定する" }),
    ).not.toBeInTheDocument();
    expect(within(section).queryByText("繰り返しなし")).not.toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "通知書が届いたら申請" })).toHaveAttribute(
      "href",
      "/todos/undated-unlinked",
    );
  });
});
