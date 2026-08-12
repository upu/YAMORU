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
});
