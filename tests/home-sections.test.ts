import { describe, expect, it, vi } from "vitest";

// src/app/page.tsxはServer Componentとしてnext-authに依存する。ここで確認したい
// のは描画を伴わない変換だけなので、認証は差し替える。
vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import {
  buildPendingSectionItems,
  buildRecentItems,
  type PendingOccurrenceRow,
  type RecentCompletionRow,
} from "../src/app/page";

// ホームに並ぶTodoの分類と、最近の実施の組み立て。描画を伴わない純粋な変換の
// ため、HomeContentの描画・操作を確認するtests/home.test.tsxから分けた(#280)。

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

  it("8/28〜8/31の担当者未設定Todoを8/30から推奨期間として表示する(Issue #281)", () => {
    const items = buildReminderItems([
      pendingRow({
        due_at: "2026-08-30T15:00:00.000Z",
        scheduled_for: "2026-08-27T15:00:00.000Z",
      }),
    ], "2026-08-29T15:00:00.000Z");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assigneeUserId: null,
      badge: "推奨期間",
      managedItemId: "item-1",
      meta: "8月31日までが推奨期間です",
      tone: "upcoming",
    });
  });

  it("80%以上はそろそろトーンで推奨期間の上限を案内し、完了操作用のmanagedItemIdを持つ", () => {
    // scheduled_for(Tokyo 8/7)〜due_at(Tokyo 9/5)の80%しきい値はTokyo 8/31
    // (Issue #52)。9/1はしきい値を過ぎ、上限日より前。
    const items = buildReminderItems([pendingRow()], "2026-09-01T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      detail: "猫の浄水器",
      detailHref: "/managed-items/item-1",
      badge: "そろそろ",
      managedItemId: "item-1",
      title: "フィルター交換",
      tone: "reminder",
    });
    expect(items[0].meta).toBe("9月5日までが推奨期間です");
  });

  it("推奨期間の上限超過はcautionトーンで責めずに案内する", () => {
    const items = buildReminderItems([pendingRow()], "2026-09-10T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0].badge).toBe("推奨期間超過");
    expect(items[0].tone).toBe("caution");
    expect(items[0].meta).toBe("9月5日に推奨期間の上限を過ぎました");
  });

  it("上限超過・80%以上・80%未満の順にし、同じ状態では上限日の昇順にする", () => {
    const items = buildReminderItems(
      [
        pendingRow({
          due_at: "2026-09-08T15:00:00.000Z",
          id: "early-later",
          scheduled_for: "2026-08-31T15:00:00.000Z",
        }),
        pendingRow({
          due_at: "2026-09-09T15:00:00.000Z",
          id: "reminder",
          scheduled_for: "2026-07-31T15:00:00.000Z",
        }),
        pendingRow({ due_at: "2026-08-19T15:00:00.000Z", id: "past" }),
        pendingRow({
          due_at: "2026-09-07T15:00:00.000Z",
          id: "early-sooner",
          scheduled_for: "2026-08-31T15:00:00.000Z",
        }),
      ],
      "2026-09-04T15:00:00.000Z",
    );
    expect(items.map((item) => item.id)).toEqual([
      "past",
      "reminder",
      "early-sooner",
      "early-later",
    ]);
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

  // Issue #99 / YDR-037: 固定間隔も厳密な期限で分類し、方式の呼び名だけが変わる。
  it("固定間隔Todoをstrict日付で分類し、一定の間隔で繰り返すと示す", () => {
    const row = onceRow("interval", "2026-08-14T15:00:00.000Z");
    row.task_rules.recurrence_basis = "interval";
    row.task_rules.title = "水槽の水換え";

    const items = buildPendingSectionItems([row], "2026-08-12T00:00:00.000Z");

    expect(items.upcoming[0]).toMatchObject({
      meta: "8月15日の予定です ・ 一定の間隔で繰り返す",
      title: "水槽の水換え",
    });
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
