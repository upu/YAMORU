import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";
import { createMaintenanceTask } from "../src/lib/d1/todos";

// Issue #292: 消耗品の関連付けを、全件チェックリストから「選択済みを表示し、
// 追加は検索して選ぶ」構成へ変えた。候補が多い家庭でも、モバイル幅で検索・
// 選択・解除ができ、保存まで通ることを実画面で確認する。ダイアログは
// DialogShellを使うため、下部ナビゲーションに覆われていればclick()が届かず
// このテストが失敗する(#156と同じ確認)。
test.use({ viewport: { width: 390, height: 844 } });

const OWNER_SESSION = { userId: "owner" };
const MANY_ITEM_COUNT = 22;

async function createItem(db: D1Database, name: string): Promise<string> {
  return createManagedItem(db, OWNER_SESSION, {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: "appliance",
    kindCode: "asset",
    name,
    note: null,
    productInfo: null,
    startedOn: null,
  });
}

async function createMaintenanceTodo(
  db: D1Database,
  managedItemId: string | null,
  title: string,
): Promise<void> {
  await createMaintenanceTask(db, OWNER_SESSION, {
    firstDueAt: "2026-09-10T15:00:00.000Z",
    firstScheduledFor: "2026-09-01T15:00:00.000Z",
    managedItemId,
    recommendedStartOffset: 1,
    recommendedUntilOffset: 2,
    title,
  });
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  const waterServerId = await createItem(db, "猫の給水機");
  const bathId = await createItem(db, "お風呂");
  // 候補が「多数」の状態を作り、初期表示が上限で区切られることを確認する。
  for (let index = 0; index < MANY_ITEM_COUNT; index += 1) {
    await createItem(db, `収納棚${String(index)}`);
  }
  await createMaintenanceTodo(db, waterServerId, "給水機のフィルターを交換する");
  await createMaintenanceTodo(db, bathId, "浴槽を掃除する");
  await createMaintenanceTodo(db, null, "防災用品を点検する");
});

test("モバイル幅で関連付けを検索して選び、解除もできる状態で保存できる", async ({ page }) => {
  await login(page);
  await page.goto("/consumables/new");

  // 未選択の候補を全件チェックリストとして並べない。
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("関連付けている管理対象はありません。")).toBeVisible();

  await page.getByLabel("名前").fill("交換フィルター");

  await page.getByRole("button", { name: "＋ 管理対象を追加" }).click();
  const itemDialog = page.getByRole("dialog", { name: "管理対象を追加" });
  await expect(itemDialog.getByText(/先頭の20件を表示しています/u)).toBeVisible();

  await itemDialog.getByLabel("管理対象を検索").fill("存在しない名前");
  await expect(itemDialog.getByText("一致する管理対象がありません。")).toBeVisible();

  await itemDialog.getByLabel("管理対象を検索").fill("給水");
  await itemDialog.getByRole("checkbox", { name: "猫の給水機" }).check();
  await itemDialog.getByLabel("管理対象を検索").fill("お風呂");
  await itemDialog.getByRole("checkbox", { name: "お風呂" }).check();
  await itemDialog.getByRole("button", { name: "選択を終える" }).click();

  await expect(page.getByRole("group", { name: "関連する管理対象（2件・任意）" })).toBeVisible();
  await page.getByRole("button", { name: "お風呂を関連から外す" }).click();
  await expect(page.getByRole("group", { name: "関連する管理対象（1件・任意）" })).toBeVisible();

  await page.getByRole("button", { name: "＋ Todoを追加" }).click();
  const todoDialog = page.getByRole("dialog", { name: "Todoを追加" });
  // 選択済みの管理対象のTodoを先頭へ寄せつつ、他のTodoも同じ検索から選べる。
  await expect(todoDialog.getByRole("checkbox").first())
    .toHaveAccessibleName("給水機のフィルターを交換する（猫の給水機）");
  await todoDialog.getByRole("checkbox", { name: "給水機のフィルターを交換する（猫の給水機）" })
    .check();
  await todoDialog.getByLabel("Todoを検索").fill("防災");
  await todoDialog.getByRole("checkbox", { name: "防災用品を点検する" }).check();
  await todoDialog.getByRole("button", { name: "選択を終える" }).click();

  await expect(page.getByRole("group", { name: "関連するTodo（2件・任意）" })).toBeVisible();

  await page.getByRole("button", { name: "消耗品を登録" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "交換フィルター" })).toBeVisible();
  const managedItems = page.getByRole("region", { name: "関連する管理対象" });
  await expect(managedItems.getByRole("link", { name: "猫の給水機" })).toBeVisible();
  await expect(managedItems.getByRole("link", { name: "お風呂" })).toHaveCount(0);
  const todos = page.getByRole("region", { name: "関連するTodo" });
  await expect(todos.getByText("給水機のフィルターを交換する")).toBeVisible();
  await expect(todos.getByText("防災用品を点検する")).toBeVisible();
});
