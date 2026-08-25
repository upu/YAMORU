import { expect, test } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
const OUTSIDER = { email: "outsider@example.test", password: "outsider-password-value" };

const TODAY_TODO = "今日の家族会議";
const LATER_TODO = "ずっと先の点検";
const UNDATED_TODO = "通知書が届いたら申請";
const OTHER_HOUSEHOLD_TODO = "別家庭のTodo";

let platform: PlatformProxy<CloudflareEnv>;

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

function tokyoDateAfter(days: number): string {
  // 実行環境のタイムゾーンに関係なく、アプリと同じAsia/Tokyoの暦日を基準にする。
  // en-CAはYYYY-MM-DD形式を返す。
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date());
  const scheduledFor = addDaysToTokyoDateUtcIso(today, days);
  if (scheduledFor === null) throw new Error("予定日を計算できなかった");
  return scheduledFor;
}

async function seedHouseholdsWithTodos(db: D1Database): Promise<void> {
  const [ownerHash, outsiderHash] = await Promise.all([
    hashPassword(OWNER.password),
    hashPassword(OUTSIDER.password),
  ]);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2), ('outsider', ?3, ?4)",
    ).bind(OWNER.email, ownerHash, OUTSIDER.email, outsiderHash),
    db.prepare(
      "INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん'), ('outsider', '別家庭さん')",
    ),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A'), ('household-b', '架空の家庭B')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner'), ('household-b', 'outsider')",
    ),
  ]);

  // ホームに出ない予定(7日より先・予定日未定)を含め、管理対象に紐づかない
  // Todoだけで一覧を組み立てる(Issue #201)。
  await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: TODAY_TODO,
  });
  await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(90),
    title: LATER_TODO,
  });
  await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: null,
    title: UNDATED_TODO,
  });
  await createOneTimeTask(db, { userId: "outsider" }, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(1),
    title: OTHER_HOUSEHOLD_TODO,
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
  await seedHouseholdsWithTodos(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("ホームから開いたTodo一覧で、自分の家庭の未完了Todoだけを日付順に確認できる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);

  // ホームは「いま対応すること」に絞るため、7日より先の予定は載せない。
  await expect(page.getByRole("heading", { level: 3, name: TODAY_TODO })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: LATER_TODO })).toHaveCount(0);
  // 予定日の設定変更はホームのカードに置かない(Issue #204)。担当と完了は残す。
  await expect(
    page.getByRole("button", { name: `${TODAY_TODO}の予定日を未定に戻す` }),
  ).toHaveCount(0);
  await expect(page.getByLabel(`${TODAY_TODO}の担当`)).toBeVisible();
  await expect(page.getByRole("button", { name: `${TODAY_TODO}を記録` })).toBeVisible();

  await page.getByRole("link", { name: "すべてのTodo" }).click();
  await expect(page).toHaveURL(/\/todos$/u);

  const section = page.getByRole("region", { name: "未完了のTodo" });
  await expect(section.getByRole("heading", { level: 3 })).toHaveText([
    TODAY_TODO,
    LATER_TODO,
    UNDATED_TODO,
  ]);
  await expect(page.getByText(OTHER_HOUSEHOLD_TODO)).toHaveCount(0);

  // 一覧から未完了Todoの基本操作を利用できる。
  await expect(
    section.getByRole("button", { name: `${UNDATED_TODO}の予定日を設定する` }),
  ).toBeVisible();
  await expect(section.getByLabel(`${TODAY_TODO}の担当`)).toBeVisible();
  await expect(section.getByRole("button", { name: `${TODAY_TODO}を記録` })).toBeVisible();
});
