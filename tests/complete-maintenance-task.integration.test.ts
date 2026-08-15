import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getLocalSupabaseEnv } from "./local-supabase-env";

type ActivityLogRow = {
  action: string;
  occurred_at: string;
  performed_by_user_id: string | null;
};
type TaskOccurrenceRow = {
  activity_logs: ActivityLogRow[];
  due_at: string;
  scheduled_for: string;
  status: string;
};

function asString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function asActivityLogRow(value: unknown): ActivityLogRow {
  if (
    value === null ||
    typeof value !== "object" ||
    !("action" in value) ||
    !("occurred_at" in value) ||
    !("performed_by_user_id" in value) ||
    typeof value.action !== "string" ||
    typeof value.occurred_at !== "string" ||
    (typeof value.performed_by_user_id !== "string" && value.performed_by_user_id !== null)
  ) {
    throw new Error("ActivityLogの形が不正です。");
  }
  return {
    action: value.action,
    occurred_at: value.occurred_at,
    performed_by_user_id: value.performed_by_user_id,
  };
}

function asTaskOccurrenceRow(value: unknown): TaskOccurrenceRow {
  if (
    value === null ||
    typeof value !== "object" ||
    !("status" in value) ||
    !("scheduled_for" in value) ||
    !("due_at" in value) ||
    !("activity_logs" in value) ||
    typeof value.status !== "string" ||
    typeof value.scheduled_for !== "string" ||
    typeof value.due_at !== "string" ||
    !Array.isArray(value.activity_logs)
  ) {
    throw new Error("Occurrenceの形が不正です。");
  }
  return {
    activity_logs: value.activity_logs.map(asActivityLogRow),
    due_at: value.due_at,
    scheduled_for: value.scheduled_for,
    status: value.status,
  };
}

// app/managed-items/[id]/page.tsxが実際に使うクエリと同じ埋め込み指定で
// TaskOccurrenceの一覧を取り出す(activity_logsへの2経路のFKを明示的に解決する)。
function extractTaskOccurrences(managedItemDetail: unknown): TaskOccurrenceRow[] {
  if (
    managedItemDetail === null ||
    typeof managedItemDetail !== "object" ||
    !("task_rules" in managedItemDetail) ||
    !Array.isArray(managedItemDetail.task_rules)
  ) {
    throw new Error("ManagedItem詳細クエリの結果が不正です。");
  }
  const taskRules = managedItemDetail.task_rules;
  const rule: unknown = taskRules.length > 0 ? taskRules[0] : null;
  if (
    rule === null ||
    typeof rule !== "object" ||
    !("task_occurrences" in rule) ||
    !Array.isArray(rule.task_occurrences)
  ) {
    throw new Error("TaskRuleのOccurrenceを取得できませんでした。");
  }
  return rule.task_occurrences.map(asTaskOccurrenceRow);
}

describe("メンテナンスTodo完了の実Auth・実DB接続", () => {
  it("完了すると、詳細画面が使うクエリで次回推奨期間と直近の完了を確認できる", async () => {
    const { publishableKey, url } = getLocalSupabaseEnv();
    const supabase = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const suffix = crypto.randomUUID();
    const signupResult = await supabase.auth.signUp({
      email: `yamoru-completion-${suffix}@example.test`,
      password: `local-test-${suffix}`,
    });
    expect(signupResult.error).toBeNull();

    const householdResult = await supabase.rpc("create_first_household", {
      household_name: "完了統合テスト家庭",
    });
    expect(householdResult.error).toBeNull();

    const itemResult = await supabase.rpc("create_managed_item", {
      external_url: null,
      item_kind: "pet_supplies",
      item_name: "猫の浄水器",
    });
    expect(itemResult.error).toBeNull();
    const itemId = asString(
      itemResult.data,
      "ManagedItem作成RPCからIDが返りませんでした。",
    );

    const taskResult = await supabase.rpc("create_maintenance_task", {
      first_due_at: "2020-01-08T00:00:00.000Z",
      first_scheduled_for: "2020-01-01T00:00:00.000Z",
      item_id: itemId,
      recommended_start_offset: 28,
      recommended_until_offset: 56,
      task_title: "フィルター交換",
    });
    expect(taskResult.error).toBeNull();

    const occurrenceLookup = await supabase
      .from("task_occurrences")
      .select("id, task_rules!inner(managed_item_id)")
      .eq("task_rules.managed_item_id", itemId)
      .single();
    expect(occurrenceLookup.error).toBeNull();
    const occurrenceId = asString(
      occurrenceLookup.data?.id,
      "最初のOccurrence IDを取得できませんでした。",
    );

    const completionResult = await supabase.rpc("complete_maintenance_task", {
      idempotency_key: crypto.randomUUID(),
      occurred_at: "2020-01-01T00:00:00.000Z",
      occurrence_id: occurrenceId,
    });
    expect(completionResult.error).toBeNull();

    const detailResult = await supabase
      .from("managed_items")
      .select(
        "id, name, kind, external_links(id, url), task_rules(id, title, task_occurrences(id, status, scheduled_for, due_at, assignee_user_id, activity_logs!activity_logs_occurrence_household_fkey(action, occurred_at, performed_by_user_id)))",
      )
      .eq("id", itemId)
      .single();
    expect(detailResult.error).toBeNull();

    const occurrences = extractTaskOccurrences(detailResult.data);
    const pending = occurrences.find((occurrence) => occurrence.status === "pending");
    const completed = occurrences.find(
      (occurrence) => occurrence.status === "completed",
    );

    // occurred_at(2020-01-01T00:00Z)の日本時間の日付(2020-01-01)へ
    // オフセット日数を足し、日本時間0時をUTCへ戻した値(YDR-012, YDR-017)。
    expect(pending?.scheduled_for).toBe("2020-01-28T15:00:00+00:00");
    expect(pending?.due_at).toBe("2020-02-25T15:00:00+00:00");
    // 実施者を省略した完了では、操作主体(signUpした自分)が実施者になる(Issue #18, YDR-020)。
    expect(completed?.activity_logs).toEqual([
      {
        action: "completed",
        occurred_at: "2020-01-01T00:00:00+00:00",
        performed_by_user_id: signupResult.data.user?.id,
      },
    ]);

    await expect(supabase.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 20_000);
});
