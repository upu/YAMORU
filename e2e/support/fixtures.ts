// ローカル実行のE2E(e2e/*.spec.ts)が共有するセットアップ。
//
// 以前は各specがWranglerプラットフォームの起動と後始末、D1の全消去、ログインを
// それぞれコピーして持っていた(#277)。特にclearDatabaseの削除順は外部キー制約に
// 依存しており、1ファイルでも順序を誤ると原因の分かりにくい失敗になる。正本を
// ここへ一つ置き、テーブルを追加したときの修正箇所を1つにする。
//
// 配備済みpreviewへ直接アクセスするe2e/preview/配下は別系統(固定の架空
// アカウントはsrc/lib/e2e/preview-fixtures.ts)で、ローカルD1を触らないため
// このモジュールは使わない。

import { test as base, expect, type Page } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import {
  assertE2EWranglerEnvironment,
  E2E_WRANGLER_ENVIRONMENT,
} from "../../scripts/e2e-environment";
import { hashPassword } from "../../src/lib/auth/password";

export type E2ECredentials = { email: string; password: string };

// 家庭Aのオーナー。実データを持ち込まないよう、説明用の値だけを使う。
export const E2E_OWNER: E2ECredentials = {
  email: "owner@example.test",
  password: "owner-password-value",
};

export const E2E_OWNER_USER_ID = "owner";
export const E2E_OWNER_NICKNAME = "家族Aさん";
export const E2E_HOUSEHOLD_ID = "household-a";
export const E2E_HOUSEHOLD_NAME = "架空の家庭A";

// 外部キー制約に沿って、参照する側から先に消す。テーブルを増やしたらここへ足す。
export async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_rule_consumables"),
    db.prepare("DELETE FROM managed_item_consumables"),
    db.prepare("DELETE FROM consumables"),
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
  ]);
}

// 家庭Aとそのオーナーだけを作る。台帳やTodoの用意は、必要なspecが
// createManagedItem・createOneTimeTaskなどをこの後に呼んで積み増す。
export async function seedOwnerHousehold(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(E2E_OWNER.password);
  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)")
      .bind(E2E_OWNER_USER_ID, E2E_OWNER.email, ownerHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES (?1, ?2)")
      .bind(E2E_OWNER_USER_ID, E2E_OWNER_NICKNAME),
    db.prepare("INSERT INTO households (id, name) VALUES (?1, ?2)")
      .bind(E2E_HOUSEHOLD_ID, E2E_HOUSEHOLD_NAME),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES (?1, ?2)")
      .bind(E2E_HOUSEHOLD_ID, E2E_OWNER_USER_ID),
  ]);
}

// ログイン画面から実際にフォームを送り、ホームへ到達したことまで確認する。
export async function login(
  page: Page,
  credentials: E2ECredentials = E2E_OWNER,
): Promise<void> {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(credentials.email);
  await loginRegion.getByLabel("パスワード").fill(credentials.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);
}

type WorkerFixtures = { platform: PlatformProxy<CloudflareEnv> };
type TestFixtures = { db: D1Database };

// platformはworker単位で一度だけ起動し、dbはテストごとに空の状態から始める。
// 各specはtest.beforeEach(async ({ db }) => ...)で必要な分だけ積み増す。
export const test = base.extend<TestFixtures, WorkerFixtures>({
  platform: [
    async ({}, provide) => {
      // 実データの入ったlocal/preview/productionへ誤って接続しない。
      assertE2EWranglerEnvironment(E2E_WRANGLER_ENVIRONMENT);
      const platform = await getPlatformProxy<CloudflareEnv>({
        environment: E2E_WRANGLER_ENVIRONMENT,
        persist: true,
        remoteBindings: false,
      });
      await provide(platform);
      await platform.dispose();
    },
    { scope: "worker" },
  ],
  db: async ({ platform }, provide) => {
    await clearDatabase(platform.env.DB);
    await provide(platform.env.DB);
  },
});

export { expect } from "@playwright/test";
