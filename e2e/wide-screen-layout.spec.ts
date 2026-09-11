import { type Locator, type Page } from "@playwright/test";

import {
  E2E_OWNER_USER_ID,
  expect,
  login,
  seedManagedItem,
  seedOwnerHousehold,
  test,
} from "./support/fixtures";

import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";
import { createOneTimeTask } from "../src/lib/d1/todos";

// Issue #397: PC幅でも本文が約700pxの単一カラムに留まり、左右が大きく空いて
// いた。画面種別ごとに最大幅と段組みを分けた(globals.cssの--page-width-*と
// .page-form / .page-list / .page-detail)。どの幅で何列になるかは実際の描画
// でしか確かめられないため、PC幅とモバイル幅の両方で位置を測る。

const ITEM_NAMES = ["エアコン", "冷蔵庫", "洗濯機", "給湯器"];
const TODO_TITLES = ["換気扇を掃除する", "浴室の排水口を掃除する"];

// フォーム画面の最大幅(globals.cssの--page-width-form)。一覧・詳細を広げても、
// 入力欄の幅と補足文の行長を保つためにこの幅のままにする。
const FORM_PAGE_MAX_WIDTH = 760;

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

type Box = { height: number; width: number; x: number; y: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("位置を取得できなかった");
  return box;
}

async function mainWidth(page: Page): Promise<number> {
  return (await boxOf(page.getByRole("main"))).width;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

// 一覧の各件の位置を、画面に並んでいる順で読む。名前から引くと、一覧の
// 並び順(登録が新しい順)と配列の順が食い違って、どちらが左かを取り違える。
async function boxesInOrder(items: Locator, count: number): Promise<Box[]> {
  await expect(items).toHaveCount(count);
  return Promise.all(
    Array.from({ length: count }, async (_unused, index) => boxOf(items.nth(index))),
  );
}

// 台帳一覧の各行。見た目のクラス名は選択子に使わない(docs/components/styles.md)
// ため、一覧領域の見出しと、1件目のリンクを含むul、その直下のliでたどる。
function ledgerRows(page: Page): Locator {
  return page
    .getByRole("region", { name: "登録済みの管理対象" })
    .locator("ul")
    .filter({ has: page.getByRole("link", { exact: true, name: ITEM_NAMES[0] }) })
    .locator("> li");
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  for (const name of ITEM_NAMES) {
    await seedManagedItem(db, name);
  }
  // 2件とも今日の予定にして、ホームでは同じ区分(「今日」)の一つの一覧へ
  // 入るようにする。区分をまたぐと別々の一覧になり、横並びを測れない。
  for (const title of TODO_TITLES) {
    await createOneTimeTask(db, { userId: E2E_OWNER_USER_ID }, {
      managedItemId: null,
      scheduledFor: tokyoDateAfter(0),
      title,
    });
  }
});

test.describe("PC幅(1440px)", () => {
  test.use({ viewport: { height: 1000, width: 1440 } });

  test("本文の最大幅は画面種別で変わり、一覧と詳細はフォームより広い", async ({ page }) => {
    await login(page);

    await page.goto("/managed-items");
    const listWidth = await mainWidth(page);

    await page.goto(`/managed-items/${await itemIdFromList(page, ITEM_NAMES[0])}`);
    const detailWidth = await mainWidth(page);

    await page.goto("/todos/new");
    const formWidth = await mainWidth(page);

    // 一覧・詳細は、これまで全画面で共通だった単一カラムの幅を超える。
    expect(listWidth).toBeGreaterThan(FORM_PAGE_MAX_WIDTH);
    expect(detailWidth).toBeGreaterThan(FORM_PAGE_MAX_WIDTH);
    // 一覧は「一度に見える件数」に幅を使うので、詳細より広い。
    expect(listWidth).toBeGreaterThan(detailWidth);
    // 登録画面は入力欄の幅と行長を保つため、広げない。
    expect(Math.round(formWidth)).toBe(FORM_PAGE_MAX_WIDTH);
  });

  test("台帳の一覧は2列に並び、1件あたりの横幅を使い切らない", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");

    const [first, second, third] = await boxesInOrder(ledgerRows(page), ITEM_NAMES.length);

    // 1件目と2件目は同じ行の左右へ並ぶ。
    expect(Math.round(second.y)).toBe(Math.round(first.y));
    expect(second.x).toBeGreaterThan(first.x);
    // 3件目は次の行の左端へ戻る。
    expect(third.y).toBeGreaterThan(first.y);
    expect(Math.round(third.x)).toBe(Math.round(first.x));
  });

  test("ホームのTodoカードも2列に並ぶ", async ({ page }) => {
    await login(page);

    const cards = page.getByRole("region", { name: "今日" }).getByRole("article");
    const [first, second] = await boxesInOrder(cards, TODO_TITLES.length);
    expect(Math.round(second.y)).toBe(Math.round(first.y));
    expect(second.x).toBeGreaterThan(first.x);
  });

  test("備品の詳細は、主要情報の右へ関連情報を並べる", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");
    await page.getByRole("link", { exact: true, name: ITEM_NAMES[0] }).click();
    await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);

    const record = await boxOf(page.getByRole("region", { name: "この管理対象の記録" }));
    const related = await boxOf(page.getByRole("region", { name: "関連する消耗品" }));

    // 関連情報は主要情報の下ではなく右側に立ち、重ならない。
    expect(Math.round(related.y)).toBe(Math.round(record.y));
    expect(related.x).toBeGreaterThanOrEqual(record.x + record.width);
    // 主要情報の側を広く取る(globals.cssの3fr : 2fr)。
    expect(record.width).toBeGreaterThan(related.width);
  });

  test("関連情報を持たないTodoの詳細は、空の列を作らず1カラムのままにする", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/todos");
    await page.getByRole("link", { exact: true, name: TODO_TITLES[0] }).click();
    await expect(page).toHaveURL(/\/todos\/[^/]+$/u);

    // 予定日だけのTodoは関連する消耗品も実施記録も持たない(#395: 導線を
    // 持たない確認専用のカードは、内容がないとき出さない)。
    await expect(page.getByRole("region", { name: "関連する消耗品" })).toHaveCount(0);

    const actions = await boxOf(page.getByRole("region", { name: "担当と完了" }));
    const content = await boxOf(page.getByRole("region", { name: "Todoの内容" }));
    const main = await boxOf(page.getByRole("main"));

    // 右側が空くのではなく、カードが本文の幅いっぱいを使う。
    expect(Math.round(content.x)).toBe(Math.round(actions.x));
    expect(content.y).toBeGreaterThan(actions.y);
    expect(actions.width).toBeGreaterThan(main.width - 100);
  });
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("一覧は単一カラムのままで、横スクロールを出さない", async ({ page }) => {
    await login(page);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.goto("/managed-items");
    const [first, second] = await boxesInOrder(ledgerRows(page), ITEM_NAMES.length);
    expect(Math.round(second.x)).toBe(Math.round(first.x));
    expect(second.y).toBeGreaterThan(first.y);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("詳細のカードはこれまでどおりの並びで縦に積まれる", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");
    await page.getByRole("link", { exact: true, name: ITEM_NAMES[0] }).click();
    await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);

    const record = await boxOf(page.getByRole("region", { name: "この管理対象の記録" }));
    const related = await boxOf(page.getByRole("region", { name: "関連する消耗品" }));
    const todos = await boxOf(page.getByRole("region", { name: "関連するTodo" }));

    // 包み(.detail-column-*)はdisplay: contentsで消えるため、重要度順の並びは
    // 変わらない(#395)。
    expect(Math.round(related.x)).toBe(Math.round(record.x));
    expect(related.y).toBeGreaterThan(record.y);
    expect(todos.y).toBeGreaterThan(related.y);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

// 段組みが切り替わる幅は、切り替えたあとの各列の幅から決めている
// (globals.cssの972px・1083px)。境界の1px手前と境界そのものを実際に描画して、
// その根拠になった数値を保つ。
test.describe("段組みが切り替わる境界", () => {
  // 390px幅での台帳一覧の1行の幅(本文358px - カードの左右16pxずつ)。
  const MOBILE_ROW_WIDTH = 326;

  test("一覧が2列になるのは972pxからで、1列はモバイルの行の幅を保つ", async ({ page }) => {
    await login(page);

    await page.setViewportSize({ height: 900, width: 971 });
    await page.goto("/managed-items");
    const narrow = await boxesInOrder(ledgerRows(page), ITEM_NAMES.length);
    expect(narrow[1].y).toBeGreaterThan(narrow[0].y);

    await page.setViewportSize({ height: 900, width: 972 });
    const wide = await boxesInOrder(ledgerRows(page), ITEM_NAMES.length);
    expect(Math.round(wide[1].y)).toBe(Math.round(wide[0].y));
    expect(wide[0].width).toBe(MOBILE_ROW_WIDTH);
  });

  test("詳細が2カラムになるのは1083pxからで、各カラムは根拠の幅を保つ", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");
    await page.getByRole("link", { exact: true, name: ITEM_NAMES[0] }).click();
    await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);

    const record = page.getByRole("region", { name: "この管理対象の記録" });
    const related = page.getByRole("region", { name: "関連する消耗品" });

    await page.setViewportSize({ height: 900, width: 1082 });
    expect((await boxOf(related)).y).toBeGreaterThan((await boxOf(record)).y);

    await page.setViewportSize({ height: 900, width: 1083 });
    const main = await boxOf(record);
    const side = await boxOf(related);
    expect(Math.round(side.y)).toBe(Math.round(main.y));
    // 主カラムは本文が下回らないとした481px(#219)、副カラムは対応する最小の
    // 画面幅320pxを下限にする。
    expect(main.width).toBeGreaterThanOrEqual(480);
    expect(side.width).toBeGreaterThanOrEqual(320);
  });
});

// 一覧から1件目のhrefを読み、詳細のURLを組み立てる。詳細の幅だけを測りたい
// テストで、クリックによる遷移を挟まずに開くために使う。
async function itemIdFromList(page: Page, name: string): Promise<string> {
  const href = await page.getByRole("link", { exact: true, name }).getAttribute("href");
  if (href === null) throw new Error("一覧のリンクを取得できなかった");
  return href.split("/").at(-1) ?? "";
}
