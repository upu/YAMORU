import { type Locator, type Page } from "@playwright/test";
import {
  expect,
  login,
  seedManagedItem,
  seedOwnerHousehold,
  test,
} from "./support/fixtures";

import { setConsumablePinned } from "../src/lib/d1/consumable-pins";
import { createConsumable } from "../src/lib/d1/consumables";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #389 / YDR-045: スマホで頻繁に使う操作は、見た目をコンパクトに保った
// まま44px以上のタップ領域を持つ。押せる大きさは要素の見た目とは限らない
// (globals.cssの.stock-status-option-symbolは疑似要素で領域だけを広げる)ため、
// 実際に押せるかどうかは「そこを押したらその操作に当たるか」で確かめる。

const TAP_TARGET = 44;
// 44pxの領域なら中心から22px離れた点まで当たる。境界の丸め誤差を避けて1px内側で見る。
const EDGE_OFFSET = TAP_TARGET / 2 - 1;

const TODO_TITLE = "浄水フィルター交換";
const MANAGED_ITEM_NAME = "冷蔵庫";
const CONSUMABLE_NAME = "食洗機用洗剤";

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

// 見た目の大きさ。疑似要素で広げた領域は含まないため、これだけでは判定しない。
async function boundingBoxOf(locator: Locator): Promise<{ height: number; width: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("要素の大きさを取得できなかった");
  return { height: box.height, width: box.width };
}

// 中心から(dx, dy)離れた点を押したときに、その操作自身へ当たるかどうか。
async function hitsFromCenter(locator: Locator, dx: number, dy: number): Promise<boolean> {
  return locator.evaluate((element, offset) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2 + offset.dx,
      rect.top + rect.height / 2 + offset.dy,
    );
    return hit !== null && element.contains(hit);
  }, { dx, dy });
}

// 上下左右それぞれへ、44pxの領域が確保されていることを確かめる。
async function expectTapTarget(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name}が表示されていない`).toBeVisible();
  const offsets = [
    { dx: 0, dy: -EDGE_OFFSET, side: "上" },
    { dx: 0, dy: EDGE_OFFSET, side: "下" },
    { dx: -EDGE_OFFSET, dy: 0, side: "左" },
    { dx: EDGE_OFFSET, dy: 0, side: "右" },
  ];
  for (const offset of offsets) {
    expect(
      await hitsFromCenter(locator, offset.dx, offset.dy),
      `${name}の${offset.side}${String(EDGE_OFFSET)}pxが押せない`,
    ).toBe(true);
  }
}

// 高さだけを確かめる(語のラベルを持つ横長のボタン・リンク)。
async function expectTapHeight(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name}が表示されていない`).toBeVisible();
  const { height } = await boundingBoxOf(locator);
  expect(height, `${name}の高さが${String(TAP_TARGET)}px未満`).toBeGreaterThanOrEqual(TAP_TARGET);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow, "横スクロールが発生している").toBe(false);
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
  const consumableId = await createConsumable(db, session, {
    externalUrl: null,
    managedItemIds: [],
    name: CONSUMABLE_NAME,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
  await setConsumablePinned(db, session, consumableId, true);
});

// 主要画面をモバイル幅で順に開き、同じ基準で確かめる。390pxを主な確認条件と
// し、320pxでは横スクロールが出ないことまで見る(issue本文の設計メモ)。
async function checkTodoListTapTargets(page: Page): Promise<void> {
  await page.goto("/todos");

  await expectTapHeight(page.getByRole("link", { name: "未完了" }), "状態切り替え(未完了)");
  await expectTapHeight(page.getByRole("link", { name: "実施済み" }), "状態切り替え(実施済み)");
  await expectTapTarget(page.getByRole("link", { name: "カード表示" }), "表示切り替え(カード)");
  await expectTapTarget(page.getByRole("link", { name: "リスト表示" }), "表示切り替え(リスト)");
  await expectTapTarget(page.getByText("担当: 全員", { exact: true }), "担当の絞り込み");
  // 検索の入り口は<summary>(ネイティブなdisclosure)なので、読み上げ名で取る。
  await expectTapTarget(page.getByLabel("Todoを検索"), "検索を開く");

  // Todoカードの担当変更と完了記録。
  await expectTapHeight(page.getByLabel(`${TODO_TITLE}の担当`), "Todoの担当");
  await expectTapHeight(
    page.getByRole("button", { name: `${TODO_TITLE}を自分の担当にする` }),
    "担当を引き受ける",
  );
  await expectTapHeight(page.getByRole("button", { name: `${TODO_TITLE}を記録` }), "完了を記録");

  // 検索フォームの送信。
  await page.getByLabel("Todoを検索").click();
  await expectTapHeight(
    page.getByRole("button", { name: "検索", exact: true }),
    "Todo内検索の送信",
  );
}

// Issue #391で3画面へそろえた戻る導線も、他の主要操作と同じ基準で押せる。
async function checkDetailBackNavTapTarget(
  page: Page,
  listPath: string,
  name: string,
  backLabel: string,
): Promise<void> {
  await page.goto(listPath);
  await page.getByRole("link", { name }).click();
  await expectTapHeight(
    page.getByRole("navigation", { name: "ページ移動" })
      .getByRole("link", { name: backLabel }),
    `${name}の詳細の戻る導線`,
  );
}

async function checkLedgerTapTargets(page: Page): Promise<void> {
  await page.goto("/managed-items");

  for (const category of ["備品", "サービス・契約", "消耗品"]) {
    await expectTapHeight(
      page.getByRole("link", { name: category, exact: true }),
      `台帳のカテゴリ切り替え(${category})`,
    );
  }
  await expectTapHeight(
    page.getByRole("link", { name: MANAGED_ITEM_NAME }),
    "台帳一覧の管理対象リンク",
  );
  await expectTapHeight(
    page.getByRole("button", { name: "名前を検索" }),
    "台帳の検索送信",
  );

  await page.goto("/consumables");
  await expectTapHeight(
    page.getByRole("link", { name: CONSUMABLE_NAME }),
    "消耗品一覧のリンク",
  );
}

async function checkCrossSearchTapTargets(page: Page): Promise<void> {
  await page.goto(`/search?q=${encodeURIComponent(MANAGED_ITEM_NAME)}`);
  await expectTapHeight(page.getByRole("button", { name: "検索" }), "横断検索の送信");
  await expectTapHeight(
    page.getByRole("link", { name: MANAGED_ITEM_NAME }),
    "横断検索の結果リンク",
  );
}

async function checkHomeTapTargets(page: Page): Promise<void> {
  await page.goto("/");
  // Issue #359 / #389: ピン留めの在庫変更は記号のまま(見た目36px)で、
  // 押せる領域だけが44pxになっている。
  const stockGroup = page.getByRole("group", { name: `${CONSUMABLE_NAME}の在庫状態を変更` });
  const available = stockGroup.getByRole("button", { name: "ある" });
  const { height, width } = await boundingBoxOf(available);
  expect(height, "記号の在庫変更ボタンの見た目が大きくなっている").toBeLessThan(TAP_TARGET);
  expect(width, "記号の在庫変更ボタンの見た目が大きくなっている").toBeLessThan(TAP_TARGET);
  await expectTapTarget(available, "ピン留めの在庫変更(ある)");
  await expectTapTarget(
    stockGroup.getByRole("button", { exact: true, name: "ない" }),
    "ピン留めの在庫変更(ない)",
  );
}

test.describe("390px幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Todo一覧・台帳・横断検索・ホームの主要操作が44px以上のタップ領域を持つ", async ({
    page,
  }) => {
    await login(page);

    await checkHomeTapTargets(page);
    await expectNoHorizontalOverflow(page);

    await checkTodoListTapTargets(page);
    await expectNoHorizontalOverflow(page);

    await checkLedgerTapTargets(page);
    await expectNoHorizontalOverflow(page);

    await checkCrossSearchTapTargets(page);
    await expectNoHorizontalOverflow(page);

    await checkDetailBackNavTapTarget(page, "/todos", TODO_TITLE, "← Todo一覧へ戻る");
    await checkDetailBackNavTapTarget(
      page, "/managed-items", MANAGED_ITEM_NAME, "← 家の台帳へ戻る",
    );
    await checkDetailBackNavTapTarget(
      page, "/consumables", CONSUMABLE_NAME, "← 家の台帳へ戻る",
    );
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("320px幅", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("最小幅でもタップ領域を保ち、横スクロールが出ない", async ({ page }) => {
    await login(page);

    for (const path of ["/", "/todos", "/managed-items", "/consumables"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }

    await page.goto("/todos");
    await expectTapTarget(page.getByRole("link", { name: "カード表示" }), "表示切り替え(カード)");
    await expectTapHeight(page.getByLabel(`${TODO_TITLE}の担当`), "Todoの担当");
    await expectNoHorizontalOverflow(page);

    await page.goto("/");
    await expectTapTarget(
      page.getByRole("group", { name: `${CONSUMABLE_NAME}の在庫状態を変更` })
        .getByRole("button", { name: "ある" }),
      "ピン留めの在庫変更(ある)",
    );
    await expectNoHorizontalOverflow(page);
  });
});
