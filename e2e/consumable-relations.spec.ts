import { expect, login, seedManagedItem, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable } from "../src/lib/d1/consumables";
import { createMaintenanceTask } from "../src/lib/d1/todos";

// Issue #292: 消耗品の関連付けを、全件チェックリストから「選択済みを表示し、
// 追加は検索して選ぶ」構成へ変えた。候補が多い家庭でも、モバイル幅で検索・
// 選択・解除ができ、保存まで通ることを実画面で確認する。ダイアログは
// DialogShellを使うため、下部ナビゲーションに覆われていればclick()が届かず
// このテストが失敗する(#156と同じ確認)。
test.use({ viewport: { width: 390, height: 844 } });

const OWNER_SESSION = { userId: "owner" };
const MANY_ITEM_COUNT = 22;

let consumableId: string;
let maintenanceOccurrenceId: string;

// Issue #357: 分類そのものは確かめないため、有効な分類はfixturesへ任せる。
async function createItem(db: D1Database, name: string): Promise<string> {
  return seedManagedItem(db, name, OWNER_SESSION.userId);
}

async function createMaintenanceTodo(
  db: D1Database,
  managedItemId: string | null,
  title: string,
): Promise<string> {
  return createMaintenanceTask(db, OWNER_SESSION, {
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
  const maintenanceTaskRuleId = await createMaintenanceTodo(
    db,
    waterServerId,
    "給水機のフィルターを交換する",
  );
  const occurrence = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1",
  ).bind(maintenanceTaskRuleId).first<{ id: string }>();
  if (occurrence === null) throw new Error("メンテナンスTodoの初回Occurrenceがありません。");
  maintenanceOccurrenceId = occurrence.id;
  await createMaintenanceTodo(db, bathId, "浴槽を掃除する");
  await createMaintenanceTodo(db, null, "防災用品を点検する");
  consumableId = await createConsumable(db, OWNER_SESSION, {
    externalUrl: null,
    managedItemIds: [],
    name: "詰め替え用洗剤",
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
});

test("モバイル幅で関連付けを検索して選び、解除もできる状態で保存できる", async ({ page }) => {
  await login(page);
  await page.goto("/consumables/new");

  // 未選択の候補を全件チェックリストとして並べない。
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  // Issue #393: 未選択であることはlegendの件数で示し、空状態の行は置かない。
  await expect(page.getByRole("group", { name: "関連する管理対象（0件・任意）" }))
    .toBeVisible();

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

// Issue #311: 関連を確認している場所から、そのまま追加・解除できるようにする。
// 追加・解除はその場でサーバーへ反映するため、読み込み直しても残る。
test("消耗品詳細の関連表示から管理対象・Todoを追加し、解除できる", async ({ page }) => {
  await login(page);
  await page.goto(`/consumables/${consumableId}`);

  const managedItems = page.getByRole("region", { name: "関連する管理対象" });
  await managedItems.getByRole("button", { name: "管理対象を追加" }).click();
  const itemDialog = page.getByRole("dialog", { name: "管理対象を追加" });
  await itemDialog.getByLabel("管理対象を検索").fill("給水");
  // 候補の選択はその場で保存するため、保存を終えてからチェックが付く。
  await itemDialog.getByRole("checkbox", { name: "猫の給水機" }).click();
  await expect(itemDialog.getByRole("checkbox", { name: "猫の給水機" })).toBeChecked();
  await itemDialog.getByRole("button", { name: "選択を終える" }).click();

  await expect(managedItems.getByRole("link", { name: "猫の給水機" })).toBeVisible();

  const todos = page.getByRole("region", { name: "関連するTodo" });
  await todos.getByRole("button", { name: "Todoを追加" }).click();
  const todoDialog = page.getByRole("dialog", { name: "Todoを追加" });
  // 選択済みの管理対象のTodoが先頭へ寄る。
  await expect(todoDialog.getByRole("checkbox").first())
    .toHaveAccessibleName("給水機のフィルターを交換する（猫の給水機）");
  await todoDialog.getByRole("checkbox", { name: "給水機のフィルターを交換する（猫の給水機）" })
    .click();
  await expect(
    todoDialog.getByRole("checkbox", { name: "給水機のフィルターを交換する（猫の給水機）" }),
  ).toBeChecked();
  await todoDialog.getByRole("button", { name: "選択を終える" }).click();

  await expect(todos.getByText("給水機のフィルターを交換する")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "関連する管理対象" })
    .getByRole("link", { name: "猫の給水機" })).toBeVisible();
  await expect(page.getByRole("region", { name: "関連するTodo" })
    .getByText("給水機のフィルターを交換する")).toBeVisible();

  await page.getByRole("button", { name: "猫の給水機を関連から外す" }).click();
  // Issue #395: 空になったら行を置かず、一覧そのものが消える。
  await expect(managedItems.getByRole("link", { name: "猫の給水機" })).toHaveCount(0);
  await expect(managedItems.getByText("関連する管理対象は0件です。")).toBeAttached();

  await page.reload();
  await expect(page.getByRole("region", { name: "関連する管理対象" })
    .getByRole("listitem")).toHaveCount(0);
  // 関連を外しても消耗品自体は残る。
  await expect(page.getByRole("heading", { level: 1, name: "詰め替え用洗剤" })).toBeVisible();
  await expect(page.getByRole("region", { name: "関連するTodo" })
    .getByText("給水機のフィルターを交換する")).toBeVisible();
});

// Issue #328: 逆方向のTodo詳細でも、関連を見ている場所から同じ検索・追加・
// 解除ができる。再読み込み後の永続化と、解除後もConsumable本体が残ることまで
// モバイル幅の実画面で確認する。
test("Todo詳細の関連する消耗品から検索して追加し、解除できる", async ({ page }) => {
  await login(page);
  await page.goto(`/todos/${maintenanceOccurrenceId}`);

  const consumables = page.getByRole("region", { name: "関連する消耗品" });
  await consumables.getByRole("button", { name: "消耗品を追加" }).click();
  const dialog = page.getByRole("dialog", { name: "消耗品を追加" });
  const searchInput = dialog.getByLabel("消耗品を検索");
  // Issue #346: iOSは16px未満の入力欄へフォーカスすると画面を自動拡大する。
  // 自動フォーカスを保ったまま、その拡大条件に入らないことを実ブラウザで確認する。
  await expect(searchInput).toBeFocused();
  await expect(searchInput).toHaveCSS("font-size", "16px");
  await searchInput.fill("詰め替え");
  await dialog.getByRole("checkbox", { name: "詰め替え用洗剤" }).click();
  await expect(dialog.getByRole("checkbox", { name: "詰め替え用洗剤" })).toBeChecked();
  await dialog.getByRole("button", { name: "選択を終える" }).click();

  await expect(consumables.getByRole("link", { name: "詰め替え用洗剤" })).toBeVisible();
  await expect(consumables.getByText("ある")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "関連する消耗品" })
    .getByRole("link", { name: "詰め替え用洗剤" })).toBeVisible();

  await page.getByRole("button", { name: "詰め替え用洗剤を関連から外す" }).click();
  // Issue #395: 空になったら行を置かず、一覧そのものが消える。
  await expect(consumables.getByRole("link", { name: "詰め替え用洗剤" })).toHaveCount(0);
  await expect(consumables.getByText("関連する消耗品は0件です。")).toBeAttached();

  await page.reload();
  await expect(page.getByRole("region", { name: "関連する消耗品" })
    .getByRole("listitem")).toHaveCount(0);
  await page.goto(`/consumables/${consumableId}`);
  await expect(page.getByRole("heading", { level: 1, name: "詰め替え用洗剤" })).toBeVisible();
});
