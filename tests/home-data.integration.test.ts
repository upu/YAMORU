import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getLocalSupabaseEnv } from "./local-supabase-env";

// app/page.tsxのloadHomeSectionsが実際に使うクエリと同じ埋め込み指定・フィルタで、
// 家庭間のRLS分離を実Auth・実DBで検証する(Issue #36)。
const PENDING_OCCURRENCES_SELECT =
  "id, scheduled_for, due_at, assignee_user_id, task_rules(id, title, deadline_kind, managed_items(id, name))";
const RECENT_ACTIVITY_SELECT =
  "id, occurred_at, performed_by_user_id, task_occurrences!activity_logs_occurrence_household_fkey(id, status, task_rules(id, title, managed_items(id, name)))";

function asString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function pendingOccurrenceTitle(row: unknown): string {
  if (
    row === null ||
    typeof row !== "object" ||
    !("task_rules" in row) ||
    row.task_rules === null ||
    typeof row.task_rules !== "object" ||
    !("title" in row.task_rules) ||
    typeof row.task_rules.title !== "string"
  ) {
    throw new Error("pending occurrenceの形が不正です。");
  }
  return row.task_rules.title;
}

function completedActivityEntry(row: unknown): { status: string; title: string } {
  if (
    row === null ||
    typeof row !== "object" ||
    !("task_occurrences" in row) ||
    row.task_occurrences === null ||
    typeof row.task_occurrences !== "object" ||
    !("status" in row.task_occurrences) ||
    typeof row.task_occurrences.status !== "string" ||
    !("task_rules" in row.task_occurrences) ||
    row.task_occurrences.task_rules === null ||
    typeof row.task_occurrences.task_rules !== "object" ||
    !("title" in row.task_occurrences.task_rules) ||
    typeof row.task_occurrences.task_rules.title !== "string"
  ) {
    throw new Error("activity_logの形が不正です。");
  }
  return {
    status: row.task_occurrences.status,
    title: row.task_occurrences.task_rules.title,
  };
}

async function createHouseholdWithMaintenanceTask(
  url: string,
  publishableKey: string,
  suffix: string,
) {
  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const signupResult = await supabase.auth.signUp({
    email: `yamoru-home-${suffix}@example.test`,
    password: `local-test-${suffix}`,
  });
  expect(signupResult.error).toBeNull();

  const householdResult = await supabase.rpc("create_first_household", {
    household_name: `ホーム統合テスト家庭${suffix}`,
  });
  expect(householdResult.error).toBeNull();

  const taskRuleTitle = `フィルター交換${suffix}`;
  const itemResult = await supabase.rpc("create_managed_item", {
    external_url: null,
    item_kind: "pet_supplies",
    item_name: `猫の浄水器${suffix}`,
  });
  expect(itemResult.error).toBeNull();
  const itemId = asString(itemResult.data, "ManagedItem作成RPCからIDが返りませんでした。");

  // scheduled_forを過去、due_atを未来にし、「そろそろ」(in-window)として
  // pending occurrencesクエリに現れるようにする。
  const taskResult = await supabase.rpc("create_maintenance_task", {
    first_due_at: "2099-01-01T00:00:00.000Z",
    first_scheduled_for: "2020-01-01T00:00:00.000Z",
    item_id: itemId,
    recommended_start_offset: 28,
    recommended_until_offset: 56,
    task_title: taskRuleTitle,
  });
  expect(taskResult.error).toBeNull();

  return { itemId, supabase, taskRuleTitle };
}

describe("ホーム画面クエリの実Auth・実DB接続(Issue #36)", () => {
  it("pendingなTaskOccurrenceとactivity_logsの完了履歴が、自家庭分だけRLS経由で見える", async () => {
    const { publishableKey, url } = getLocalSupabaseEnv();
    const suffixA = crypto.randomUUID();
    const suffixB = crypto.randomUUID();

    const householdA = await createHouseholdWithMaintenanceTask(url, publishableKey, suffixA);
    const householdB = await createHouseholdWithMaintenanceTask(url, publishableKey, suffixB);

    // 家庭Aの最初のOccurrenceを完了し、活動履歴を1件作る。
    const occurrenceLookup = await householdA.supabase
      .from("task_occurrences")
      .select("id, task_rules!inner(managed_item_id)")
      .eq("task_rules.managed_item_id", householdA.itemId)
      .single();
    expect(occurrenceLookup.error).toBeNull();
    const occurrenceId = asString(
      occurrenceLookup.data?.id,
      "家庭Aの最初のOccurrence IDを取得できませんでした。",
    );
    const completionResult = await householdA.supabase.rpc("complete_maintenance_task", {
      idempotency_key: crypto.randomUUID(),
      occurred_at: "2026-08-01T00:00:00.000Z",
      occurrence_id: occurrenceId,
    });
    expect(completionResult.error).toBeNull();

    // ---- 家庭Aから見たpending occurrences: 自家庭分だけ見える ----
    const pendingAsA = await householdA.supabase
      .from("task_occurrences")
      .select(PENDING_OCCURRENCES_SELECT)
      .eq("status", "pending");
    expect(pendingAsA.error).toBeNull();
    const pendingTitlesAsA = (pendingAsA.data ?? []).map(pendingOccurrenceTitle);
    expect(pendingTitlesAsA).toContain(householdA.taskRuleTitle);
    expect(pendingTitlesAsA).not.toContain(householdB.taskRuleTitle);

    // ---- 家庭Bから見たpending occurrences: 家庭Aの分は見えない ----
    const pendingAsB = await householdB.supabase
      .from("task_occurrences")
      .select(PENDING_OCCURRENCES_SELECT)
      .eq("status", "pending");
    expect(pendingAsB.error).toBeNull();
    const pendingTitlesAsB = (pendingAsB.data ?? []).map(pendingOccurrenceTitle);
    expect(pendingTitlesAsB).toContain(householdB.taskRuleTitle);
    expect(pendingTitlesAsB).not.toContain(householdA.taskRuleTitle);

    // ---- 完了履歴(activity_logs): 家庭Aだけに完了記録が見える ----
    const recentAsA = await householdA.supabase
      .from("activity_logs")
      .select(RECENT_ACTIVITY_SELECT)
      .eq("action", "completed");
    expect(recentAsA.error).toBeNull();
    expect(recentAsA.data).toHaveLength(1);
    const recentEntry = completedActivityEntry(recentAsA.data?.[0]);
    expect(recentEntry.status).toBe("completed");
    expect(recentEntry.title).toBe(householdA.taskRuleTitle);

    const recentAsB = await householdB.supabase
      .from("activity_logs")
      .select(RECENT_ACTIVITY_SELECT)
      .eq("action", "completed");
    expect(recentAsB.error).toBeNull();
    expect(recentAsB.data).toHaveLength(0);

    await expect(householdA.supabase.auth.signOut()).resolves.toMatchObject({ error: null });
    await expect(householdB.supabase.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 30_000);
});
