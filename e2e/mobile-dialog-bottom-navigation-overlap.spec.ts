import { expect, test } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";
import { formatDateInput } from "../src/app/time-zone";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
let platform: PlatformProxy<CloudflareEnv>;
let managedItemId: string;
const TASK_TITLE = "浄水フィルター交換";

// #146(下部ナビゲーション追加)以降、モバイル幅の完了記録・延期ダイアログは
// 画面下端に張り付く「ボトムシート」表示になる。下部ナビゲーションより手前に
// 出し、その高さぶんレイアウトを詰めていなければ、ダイアログ最下部の選択肢は
// 下部ナビゲーションに覆われてタップを奪われる(#156)。Playwrightのclick()は
// 要素が他の要素に覆われている間タップを実イベントとして届けないため、この
// テストは実機での「重なって押せない」不具合をそのまま再現できる。
test.use({ viewport: { width: 390, height: 844 } });

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
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

async function seedOwnerWithPendingTodo(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
    db.prepare(
      "INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')",
    ),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
  const session = { userId: "owner" };
  managedItemId = await createManagedItem(db, session, {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: "other",
    kindCode: "other",
    name: TASK_TITLE,
  });
  const today = formatDateInput(new Date());
  await createOneTimeTask(db, session, {
    managedItemId,
    scheduledFor: today,
    title: TASK_TITLE,
  });
}

test.beforeAll(async () => {
  platform = await getPlatformProxy<CloudflareEnv>({
    environment: E2E_WRANGLER_ENVIRONMENT,
    persist: true,
    remoteBindings: false,
  });
});

test.beforeEach(async () => {
  await clearDatabase(platform.env.DB);
  await seedOwnerWithPendingTodo(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("モバイル幅で完了記録・延期ダイアログの選択肢が下部ナビゲーションと重ならず操作できる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);

  await page.goto(`/managed-items/${managedItemId}`);

  const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
  await expect(navigation).toBeVisible();

  // 完了記録ダイアログ: 下側の選択肢「詳しく記録する」が実機で押しにくいと
  // 報告された(#156)。実際にタップし、詳細入力へ遷移することを確認する。
  await page.getByRole("button", { name: `${TASK_TITLE}を記録` }).click();
  const completionDialog = page.getByRole("dialog", { name: `${TASK_TITLE}を記録` });
  await expect(completionDialog).toBeVisible();
  await completionDialog.getByRole("button", { name: "詳しく記録する" }).click();
  await expect(completionDialog.getByLabel("実施日")).toBeVisible();
  await completionDialog.getByRole("button", { name: "閉じる" }).click();
  await expect(completionDialog).toBeHidden();

  // 延期ダイアログ: 同じDialogShellを使う別のダイアログでも、送信ボタンが
  // 下部ナビゲーションに覆われずタップできることを確認する。
  await page.getByRole("button", { name: `${TASK_TITLE}を延期する` }).click();
  const postponeDialog = page.getByRole("dialog", { name: `${TASK_TITLE}を延期` });
  await expect(postponeDialog).toBeVisible();
  await postponeDialog.getByRole("button", { name: "この日まで延期する" }).click();
  await expect(page.getByText("まで延期しました。")).toBeVisible();

  // ダイアログを閉じれば下部ナビゲーションの操作性が元に戻る。
  await navigation.getByRole("link", { name: "ホーム" }).click();
  await expect(page).toHaveURL(/\/$/u);
});
