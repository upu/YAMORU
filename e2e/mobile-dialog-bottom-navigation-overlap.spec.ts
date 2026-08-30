import { E2E_OWNER, expect, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { formatDateInput } from "../src/app/time-zone";

let managedItemId: string;
const TASK_TITLE = "浄水フィルター交換";

// #146(下部ナビゲーション追加)以降、モバイル幅の完了記録・延期ダイアログは
// 画面下端に張り付く「ボトムシート」表示になる。下部ナビゲーションより手前に
// 出し、その高さぶんレイアウトを詰めていなければ、ダイアログ最下部の選択肢は
// 下部ナビゲーションに覆われてタップを奪われる(#156)。Playwrightのclick()は
// 要素が他の要素に覆われている間タップを実イベントとして届けないため、この
// テストは実機での「重なって押せない」不具合をそのまま再現できる。
test.use({ viewport: { width: 390, height: 844 } });

async function seedOwnerWithPendingTodo(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  managedItemId = await createManagedItem(db, session, {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: "other",
    kindCode: "other",
    name: TASK_TITLE,
    note: null,
    productInfo: null,
    startedOn: null,
  });
  const today = formatDateInput(new Date());
  await createOneTimeTask(db, session, {
    managedItemId,
    scheduledFor: today,
    title: TASK_TITLE,
  });
}

test.beforeEach(async ({ db }) => {
  await seedOwnerWithPendingTodo(db);
});

test("モバイル幅で完了記録・延期ダイアログの選択肢が下部ナビゲーションと重ならず操作できる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(E2E_OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(E2E_OWNER.password);
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
