import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getLocalSupabaseEnv } from "./local-supabase-env";

describe("ローカルSupabase Auth接続", () => {
  it("登録、ログイン、検証済み利用者取得、ログアウトを実行できる", async () => {
    const { publishableKey, url } = getLocalSupabaseEnv();
    const supabase = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const suffix = crypto.randomUUID();
    const credentials = {
      email: `yamoru-auth-${suffix}@example.test`,
      password: `local-test-${suffix}`,
    };

    const signupResult = await supabase.auth.signUp(credentials);
    expect(signupResult.error).toBeNull();
    expect(signupResult.data.user?.email).toBe(credentials.email);
    expect(signupResult.data.session).not.toBeNull();

    await expect(supabase.auth.signOut()).resolves.toMatchObject({ error: null });

    const loginResult = await supabase.auth.signInWithPassword(credentials);
    expect(loginResult.error).toBeNull();
    expect(loginResult.data.session).not.toBeNull();

    const userResult = await supabase.auth.getUser();
    expect(userResult.error).toBeNull();
    expect(userResult.data.user?.email).toBe(credentials.email);

    await expect(supabase.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 20_000);

  it("登録した利用者が最初の家庭を一度だけ作成し、再ログイン後も参照できる", async () => {
    const { publishableKey, url } = getLocalSupabaseEnv();
    const options = {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    };
    const firstClient = createClient(url, publishableKey, options);
    const secondClient = createClient(url, publishableKey, options);
    const suffix = crypto.randomUUID();
    const credentials = {
      email: `yamoru-household-${suffix}@example.test`,
      password: `local-test-${suffix}`,
    };

    const signupResult = await firstClient.auth.signUp(credentials);
    expect(signupResult.error).toBeNull();
    const secondLogin = await secondClient.auth.signInWithPassword(credentials);
    expect(secondLogin.error).toBeNull();

    const creationResults = await Promise.all([
      firstClient.rpc("create_first_household", {
        household_name: "  統合テスト家庭  ",
      }),
      secondClient.rpc("create_first_household", {
        household_name: "統合テスト家庭",
      }),
    ]);

    expect(creationResults.every(({ error }) => error === null)).toBe(true);
    const firstHouseholdId = creationResults[0].data as unknown;
    const secondHouseholdId = creationResults[1].data as unknown;
    expect(typeof firstHouseholdId).toBe("string");
    expect(secondHouseholdId).toBe(firstHouseholdId);
    if (typeof firstHouseholdId !== "string") {
      throw new Error("家庭作成RPCから家庭IDが返りませんでした。");
    }

    await expect(firstClient.auth.signOut()).resolves.toMatchObject({ error: null });
    await expect(secondClient.auth.signOut()).resolves.toMatchObject({ error: null });
    const reloginResult = await firstClient.auth.signInWithPassword(credentials);
    expect(reloginResult.error).toBeNull();

    const householdResult = await firstClient
      .from("households")
      .select("id, name");
    expect(householdResult.error).toBeNull();
    expect(householdResult.data).toEqual([
      { id: firstHouseholdId, name: "統合テスト家庭" },
    ]);

    const membershipResult = await firstClient
      .from("household_members")
      .select("household_id, user_id");
    expect(membershipResult.error).toBeNull();
    expect(membershipResult.data).toHaveLength(1);
    expect(membershipResult.data?.[0]).toMatchObject({
      household_id: firstHouseholdId,
      user_id: signupResult.data.user?.id,
    });

    await expect(firstClient.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 20_000);

  it("実Auth利用者が自家庭のManagedItemへTaskRuleと最初のOccurrenceを登録できる", async () => {
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
      email: `yamoru-maintenance-${suffix}@example.test`,
      password: `local-test-${suffix}`,
    });
    expect(signupResult.error).toBeNull();

    const householdResult = await supabase.rpc("create_first_household", {
      household_name: "メンテナンス統合テスト家庭",
    });
    expect(householdResult.error).toBeNull();

    const itemResult = await supabase.rpc("create_managed_item", {
      external_url: null,
      item_kind: "pet_supplies",
      item_name: "猫の浄水器",
    });
    expect(itemResult.error).toBeNull();
    const itemId: unknown = itemResult.data;
    expect(typeof itemId).toBe("string");
    if (typeof itemId !== "string") {
      throw new Error("ManagedItem作成RPCからIDが返りませんでした。");
    }

    const taskResult = await supabase.rpc("create_maintenance_task", {
      first_due_at: "2026-11-05T15:00:00.000Z",
      first_scheduled_for: "2026-10-08T15:00:00.000Z",
      item_id: itemId,
      recommended_start_offset: 28,
      recommended_until_offset: 56,
      task_title: "フィルター交換",
    });
    expect(taskResult.error).toBeNull();
    const taskRuleId: unknown = taskResult.data;
    expect(typeof taskRuleId).toBe("string");
    if (typeof taskRuleId !== "string") {
      throw new Error("Todo作成RPCからTaskRule IDが返りませんでした。");
    }

    const savedTaskResult = await supabase
      .from("task_rules")
      .select(
        "id, title, recommended_start_offset, recommended_until_offset, task_occurrences(id, status, scheduled_for, due_at)",
      )
      .eq("id", taskRuleId)
      .single();
    expect(savedTaskResult.error).toBeNull();
    const savedTask: unknown = savedTaskResult.data;
    expect(savedTask).toMatchObject({
      id: taskRuleId,
      recommended_start_offset: 28,
      recommended_until_offset: 56,
      title: "フィルター交換",
    });
    if (
      savedTask === null ||
      typeof savedTask !== "object" ||
      !("task_occurrences" in savedTask) ||
      !Array.isArray(savedTask.task_occurrences)
    ) {
      throw new Error("TaskRuleのOccurrenceを取得できませんでした。");
    }
    expect(savedTask.task_occurrences).toHaveLength(1);
    const occurrence: unknown = savedTask.task_occurrences[0];
    if (
      occurrence === null ||
      typeof occurrence !== "object" ||
      !("status" in occurrence) ||
      !("scheduled_for" in occurrence) ||
      !("due_at" in occurrence) ||
      typeof occurrence.scheduled_for !== "string" ||
      typeof occurrence.due_at !== "string"
    ) {
      throw new Error("最初のOccurrenceが不正です。");
    }
    expect(occurrence.status).toBe("pending");
    expect(new Date(occurrence.scheduled_for).toISOString()).toBe(
      "2026-10-08T15:00:00.000Z",
    );
    expect(new Date(occurrence.due_at).toISOString()).toBe(
      "2026-11-05T15:00:00.000Z",
    );

    await expect(supabase.auth.signOut()).resolves.toMatchObject({ error: null });
  }, 20_000);
});
