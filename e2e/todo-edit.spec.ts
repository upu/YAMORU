import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

const ORIGINAL_TITLE = "通知書が届いたら申請";
const EDITED_TITLE = "申請書を郵送する";
const MANAGED_ITEM_NAME = "リビングのエアコン";

let managedItemId: string;

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
  await seedOwnerHousehold(db);
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

test.beforeEach(async ({ db }) => {
  await seedUndatedTodo(db);
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
