import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "../lib/supabase/database.types";
import { getLocalSupabaseEnv } from "./local-supabase-env";

// app/page.tsxのloadHomeSectionsが実際に使うクエリとRPCで、家庭間のRLS分離と
// 取消後の再完了表示を実Auth・実DBで検証する(Issue #36, #106)。
const PENDING_OCCURRENCES_SELECT =
  "id, scheduled_for, due_at, assignee_user_id, task_rules(id, title, deadline_kind, managed_items(id, name))";

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

async function createHouseholdWithMaintenanceTask(
  url: string,
  publishableKey: string,
  suffix: string,
) {
  const supabase = createClient<Database>(url, publishableKey, {
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

describe("ホーム画面クエリの実Auth・実DB接続(Issue #36, #106)", () => {
  it("取消後の再完了だけを最近の実施へ返し、家庭間をRLSで分離する", async () => {
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

    // ---- 最近の実施: 家庭Aだけに現在有効な完了が見える ----
    const recentAsA = await householdA.supabase.rpc("list_recent_active_completions", {
      max_results: 10,
    });
    expect(recentAsA.error).toBeNull();
    expect(recentAsA.data).toHaveLength(1);
    expect(recentAsA.data?.[0]?.task_rule_title).toBe(householdA.taskRuleTitle);

    const recentAsB = await householdB.supabase.rpc("list_recent_active_completions", {
      max_results: 10,
    });
    expect(recentAsB.error).toBeNull();
    expect(recentAsB.data).toHaveLength(0);

    const undoResult = await householdA.supabase.rpc("undo_maintenance_task_completion", {
      idempotency_key: crypto.randomUUID(),
      occurrence_id: occurrenceId,
    });
    expect(undoResult.error).toBeNull();

    const recentAfterUndo = await householdA.supabase.rpc(
      "list_recent_active_completions",
      { max_results: 10 },
    );
    expect(recentAfterUndo.error).toBeNull();
    expect(recentAfterUndo.data).toHaveLength(0);

    const recompletionResult = await householdA.supabase.rpc("complete_maintenance_task", {
      idempotency_key: crypto.randomUUID(),
      occurred_at: "2026-07-30T00:00:00.000Z",
      occurrence_id: occurrenceId,
    });
    expect(recompletionResult.error).toBeNull();

    const recentAfterRecompletion = await householdA.supabase.rpc(
      "list_recent_active_completions",
      { max_results: 10 },
    );
    expect(recentAfterRecompletion.error).toBeNull();
    expect(recentAfterRecompletion.data).toHaveLength(1);
    expect(recentAfterRecompletion.data?.[0]).toMatchObject({
      occurred_at: "2026-07-30T00:00:00+00:00",
      task_occurrence_id: occurrenceId,
      task_rule_title: householdA.taskRuleTitle,
    });

    const completionHistory = await householdA.supabase
      .from("activity_logs")
      .select("id")
      .eq("task_occurrence_id", occurrenceId)
      .eq("action", "completed");
    expect(completionHistory.error).toBeNull();
    expect(completionHistory.data).toHaveLength(2);

    await expect(householdA.supabase.auth.signOut()).resolves.toMatchObject({ error: null });
    await expect(householdB.supabase.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 30_000);
});
