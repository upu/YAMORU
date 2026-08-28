import { expect, test, type Page } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
const ORIGINAL_TITLE = "通知書が届いたら申請";
const EDITED_TITLE = "申請書を郵送する";
const MANAGED_ITEM_NAME = "リビングのエアコン";

let platform: PlatformProxy<CloudflareEnv>;
let managedItemId: string;

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
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

// アプリと同じAsia/Tokyoの暦日で、date入力へ渡すYYYY-MM-DDを作る。
// en-CAはYYYY-MM-DD形式を返す。
function toTokyoDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(date);
}

function tokyoDateStringAfter(days: number): string {
  const iso = addDaysToTokyoDateUtcIso(toTokyoDateString(new Date()), days);
  if (iso === null) throw new Error("予定日を計算できなかった");
  return toTokyoDateString(new Date(iso));
}

async function seedUndatedTodo(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
  managedItemId = await createManagedItem(db, { userId: "owner" }, {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "asset",
    name: MANAGED_ITEM_NAME,
    note: null,
    productInfo: null,
    startedOn: null,
  });
  // 予定日未定・管理対象なし・担当なしのTodoから編集を始める(YDR-030)。
  await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: null,
    title: ORIGINAL_TITLE,
  });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);
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
  await seedUndatedTodo(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("Todo一覧からTodo詳細を開き、名前・予定日・担当・管理対象を編集して各画面へ反映する", async ({
  page,
}) => {
  await login(page);

  await page.goto("/todos");
  await page.getByRole("link", { name: ORIGINAL_TITLE }).click();
  await expect(page).toHaveURL(/\/todos\/[^/]+$/u);
  await expect(page.getByRole("heading", { level: 1, name: ORIGINAL_TITLE })).toBeVisible();
  const summary = page.getByRole("region", { name: "Todoの内容" });
  await expect(summary.getByText("関連する管理対象なし")).toBeVisible();
  await expect(summary.getByText("誰でも可")).toBeVisible();
  await expect(summary.getByText("未定", { exact: true })).toBeVisible();
  const detailUrl = page.url();

  // キャンセルでは保存しない。
  await page.getByRole("link", { name: "編集" }).click();
  await page.getByLabel("Todo名").fill("保存しない名前");
  await page.getByRole("link", { name: "キャンセル" }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { level: 1, name: ORIGINAL_TITLE })).toBeVisible();

  await page.getByRole("link", { name: "編集" }).click();
  await page.getByLabel("Todo名").fill(EDITED_TITLE);
  await page.getByLabel("予定日").fill(tokyoDateStringAfter(3));
  await page.getByLabel("担当").selectOption({ label: "家族Aさん" });
  await page.getByRole("searchbox", { name: "管理対象を検索" }).fill("エアコン");
  await page.getByRole("radio", { name: MANAGED_ITEM_NAME }).check();
  await page.getByRole("button", { name: "変更を保存" }).click();

  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { level: 1, name: EDITED_TITLE })).toBeVisible();
  await expect(summary.getByRole("link", { name: MANAGED_ITEM_NAME })).toBeVisible();
  await expect(summary.getByText("家族Aさん")).toBeVisible();
  await expect(summary.getByText("未定", { exact: true })).toHaveCount(0);

  // ホーム(近日)と管理対象の詳細にも、変更後の内容が反映される。
  await page.goto("/");
  await expect(page.getByRole("link", { name: EDITED_TITLE })).toBeVisible();
  await page.goto(`/managed-items/${managedItemId}`);
  await expect(page.getByText(EDITED_TITLE, { exact: true })).toBeVisible();
});
