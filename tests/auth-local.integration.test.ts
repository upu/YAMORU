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
});
