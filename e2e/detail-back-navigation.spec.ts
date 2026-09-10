import { expect, login, seedManagedItem, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable } from "../src/lib/d1/consumables";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #391: 一覧 → 詳細 → 一覧の往復と、一覧 → 追加を、Todo・備品・消耗品で
// 同じ手順のまま確かめる(受け入れ基準「既存の追加・編集・詳細遷移が失われて
// いないことをテストする」)。モバイル幅で、戻る導線が本文や下部ナビゲーションと
// 重ならないことも見る。

const TODO_TITLE = "フィルターの申請";
const MANAGED_ITEM_NAME = "猫の浄水器";
const CONSUMABLE_NAME = "トイレットペーパー";

function tokyoDateAfter(days: number): string {
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

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  await seedManagedItem(db, MANAGED_ITEM_NAME);
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(1),
    title: TODO_TITLE,
  });
  await createConsumable(db, session, {
    externalUrl: null,
    managedItemIds: [],
    name: CONSUMABLE_NAME,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
});

const DETAILS: { addLabel: string; backLabel: string; editLabel: string; listPath: string; name: string; newPath: RegExp }[] = [
  {
    addLabel: "Todoを追加",
    backLabel: "← Todo一覧へ戻る",
    editLabel: "Todoを編集",
    listPath: "/todos",
    name: TODO_TITLE,
    newPath: /\/todos\/new$/u,
  },
  {
    addLabel: "備品を登録",
    backLabel: "← 家の台帳へ戻る",
    editLabel: "管理対象を編集",
    listPath: "/managed-items",
    name: MANAGED_ITEM_NAME,
    newPath: /\/managed-items\/new$/u,
  },
  {
    addLabel: "消耗品を登録",
    backLabel: "← 家の台帳へ戻る",
    editLabel: "消耗品を編集",
    listPath: "/consumables",
    name: CONSUMABLE_NAME,
    newPath: /\/consumables\/new$/u,
  },
];

test.describe("モバイル幅", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("Todo・備品・消耗品で、一覧から詳細を開き同じ位置の戻る導線で一覧へ帰れる", async ({
    page,
  }) => {
    await login(page);

    for (const detail of DETAILS) {
      await page.goto(detail.listPath);
      await page.getByRole("link", { name: detail.name }).click();

      // 戻る導線はページ移動のnavとして最上部にあり、下部ナビゲーションとは
      // 重ならない(本文より上に置く)。
      const backNav = page.getByRole("navigation", { name: "ページ移動" });
      const backLink = backNav.getByRole("link", { name: detail.backLabel });
      await expect(backLink).toBeVisible();
      const heading = page.getByRole("heading", { level: 1, name: detail.name });
      const [backBox, headingBox] = await Promise.all([
        backLink.boundingBox(),
        heading.boundingBox(),
      ]);
      expect(backBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect((backBox?.y ?? 0) + (backBox?.height ?? 0))
        .toBeLessThanOrEqual(headingBox?.y ?? 0);

      // 編集導線は詳細の中に残る。
      await expect(page.getByRole("link", { name: detail.editLabel })).toBeVisible();

      await backLink.click();
      await expect(page).toHaveURL(new RegExp(`${detail.listPath}$`, "u"));

      // 一覧の追加導線も、モバイル幅では右下のボタンから同じ登録画面へ進む。
      await page.getByRole("link", { name: detail.addLabel }).click();
      await expect(page).toHaveURL(detail.newPath);
    }
  });
});
