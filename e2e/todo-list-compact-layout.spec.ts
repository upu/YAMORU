import { type Locator, type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #390: 390px幅のTodo一覧で、ツールバーの操作が意図したまとまりで
// 収まっているか(検索だけが次行へ取り残されていないか)と、コンパクトな
// リスト表示の1行に主要情報が収まっているかを、実際の配置で確かめる。
// 行数や折り返しは文字幅で決まるため、jsdomのコンポーネントテストでは
// 見えない(受け入れ基準の「390px幅で」に当たる確認)。

const SHORT_TODO = "ごみ出し";
const LONG_TODO = "浄水器のフィルターを交換して記録を残す長いタイトルのTodo";
// 登録できる上限の20文字(src/app/account/actions.tsのNICKNAME_MAX_LENGTH)。
const LONG_NICKNAME = "あいうえおかきくけこさしすせそたちつてと";
const LONG_NICKNAME_USER_ID = "member2";
// 文字サイズだけを2倍にした状態(既定16px)。ページ全体の拡大とは違い、
// 幅は変わらず文字だけが大きくなるため、1行に収める指定の逃げ場を確かめられる。
const DOUBLED_TEXT_STYLE = "html { font-size: 32px !important; }";

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

async function boxOf(locator: Locator, name: string): Promise<Box> {
  await expect(locator, `${name}が表示されていない`).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${name}の大きさを取得できなかった`);
  return box;
}

// 同じ行に並んでいるか。上下の中心が互いの高さの範囲に収まっていれば同じ行とみなす
// (高さの違う操作が縦中央でそろうため、yの一致では見られない)。
function isSameRow(left: Box, right: Box): boolean {
  const leftCenter = left.y + left.height / 2;
  const rightCenter = right.y + right.height / 2;
  return leftCenter >= right.y && leftCenter <= right.y + right.height
    && rightCenter >= left.y && rightCenter <= left.y + left.height;
}

// 画面の並び(上の行が先、同じ行なら左が先)どおりにキーボードで移動できるか。
// 名前の並びをそのままDOMの順として確かめる(タブ移動順はDOMの順で決まる)。
async function expectFocusOrderFollowsRows(page: Page, names: string[]): Promise<void> {
  const positions = await page.evaluate((accessibleNames) => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>("main a[href], main summary"),
    );
    return accessibleNames.map((name) => focusable.findIndex((element) => {
      const ariaLabel = element.getAttribute("aria-label");
      const label = ariaLabel === null ? element.textContent : ariaLabel;
      return label.trim() === name;
    }));
  }, names);

  for (const [index, position] of positions.entries()) {
    expect(position, `${names[index] ?? ""}が見つからない`).toBeGreaterThanOrEqual(0);
    if (index === 0) continue;
    expect(
      position,
      `${names[index] ?? ""}が${names[index - 1] ?? ""}より前に移動順へ現れる`,
    ).toBeGreaterThan(positions[index - 1] ?? -1);
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow, "横スクロールが発生している").toBe(false);
}

// 中身が入れ物の右端からはみ出していないか。一覧(.rows)は角丸のために
// overflow: hiddenなので、はみ出した部分は隠れて読めなくなる。
async function overflowsContainer(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const container = element.parentElement;
    if (container === null) return false;
    return element.getBoundingClientRect().right > container.getBoundingClientRect().right + 1;
  });
}

// 見た目が省略表示になっているか(はみ出した分だけscrollWidthが大きくなる)。
async function isTruncated(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  // 長い家族名でツールバーが広がらないことを確かめるための、もう一人の家族。
  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, 'e2e-not-a-real-hash')")
      .bind(LONG_NICKNAME_USER_ID, `${LONG_NICKNAME_USER_ID}@example.test`),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES (?1, ?2)")
      .bind(LONG_NICKNAME_USER_ID, LONG_NICKNAME),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', ?1)")
      .bind(LONG_NICKNAME_USER_ID),
  ]);
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: SHORT_TODO,
  });
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(2),
    title: LONG_TODO,
  });
});

test.describe("390px幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ツールバーは絞り込みとそれ以外の操作でまとまり、検索だけが次行へ残らない", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/todos");

    const search = await boxOf(page.getByLabel("Todoを検索"), "検索を開く");
    const listView = await boxOf(page.getByRole("link", { name: "リスト表示" }), "リスト表示");
    const cardView = await boxOf(page.getByRole("link", { name: "カード表示" }), "カード表示");
    const pending = await boxOf(page.getByRole("link", { name: "未完了" }), "未完了");
    const done = await boxOf(page.getByRole("link", { name: "実施済み" }), "実施済み");
    const assignee = await boxOf(page.getByText("担当: 全員", { exact: true }), "担当の絞り込み");

    // 検索は表示形式と同じ行に並ぶ(単独で次の行へ取り残されない)。
    expect(isSameRow(search, listView), "検索が表示形式と別の行にある").toBe(true);
    expect(isSameRow(listView, cardView), "表示形式の2択が別の行に分かれている").toBe(true);

    // 絞り込み(状態・担当)は互いに同じ行で、操作群とは別の行にまとまる。
    expect(isSameRow(pending, done), "状態の2択が別の行に分かれている").toBe(true);
    expect(isSameRow(pending, assignee), "状態と担当が別の行に分かれている").toBe(true);
    expect(isSameRow(pending, search), "絞り込みと検索が同じ行に混ざっている").toBe(false);

    // まとまりは2行までで、どの操作もはみ出さない。
    expect(search.y, "検索が絞り込みより下の行にある").toBeLessThan(pending.y);
    await expectNoHorizontalOverflow(page);

    // 画面の並び(上の行が先)とキーボードの移動順が一致する。CSSのorderで
    // 見た目だけを入れ替えると、下の行を先にたどってから上の行へ戻ることになる。
    await expectFocusOrderFollowsRows(page, ["リスト表示", "Todoを検索", "未完了", "実施済み"]);
  });

  test("リスト表示は短いTodoを1行に収め、長いタイトルだけを省略する", async ({ page }) => {
    await login(page);
    await page.goto("/todos?view=list");

    const shortRow = page.getByRole("link", { name: new RegExp(SHORT_TODO) });
    const shortRowBox = await boxOf(shortRow, `${SHORT_TODO}の行`);
    const shortTitle = await boxOf(
      shortRow.getByText(SHORT_TODO, { exact: true }),
      `${SHORT_TODO}のタイトル`,
    );
    const shortBadge = await boxOf(shortRow.getByText("今日", { exact: true }), "状態ラベル");

    // 短いTodoはタイトル・日付/状態・状態ラベルが1行に収まる。
    expect(isSameRow(shortTitle, shortBadge), "状態ラベルが2行目へ落ちている").toBe(true);
    expect(shortRowBox.height, "短いTodoの行が1行に収まっていない").toBeLessThanOrEqual(48);
    expect(await isTruncated(shortRow.getByText(SHORT_TODO, { exact: true }))).toBe(false);

    // 長いタイトルは省略表示になり、状態ラベルを押し出さない。
    const longRow = page.getByRole("link", { name: new RegExp(LONG_TODO) });
    const longRowBox = await boxOf(longRow, `${LONG_TODO}の行`);
    const longTitleLocator = longRow.getByText(LONG_TODO, { exact: true });
    const longTitle = await boxOf(longTitleLocator, `${LONG_TODO}のタイトル`);
    const longBadge = await boxOf(longRow.getByText("予定", { exact: true }), "状態ラベル");

    expect(await isTruncated(longTitleLocator), "長いタイトルが省略表示になっていない").toBe(true);
    expect(isSameRow(longTitle, longBadge), "長いタイトルが状態ラベルを押し出している").toBe(true);
    expect(longRowBox.height, "長いTodoの行が2行以上になっている").toBeLessThanOrEqual(48);

    // 省略しても、行全体のリンク名にはTodo名の全文が残る。
    await expect(longRow).toHaveAccessibleName(new RegExp(LONG_TODO));

    // 行は引き続きTodo詳細への単一の導線(#224)。
    await longRow.click();
    await expect(page).toHaveURL(/\/todos\/[^/?]+$/u);

    await page.goBack();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("文字サイズを2倍にした390px幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // 1行へ収める指定が、文字サイズを大きくしたときに情報を隠す形で効かないこと。
  // 入り切らなくなったら、状態ラベルは隠れるのではなく次の行へ回る。
  test("リスト行は状態ラベルを隠さず、折り返して表示する", async ({ page }) => {
    await login(page);
    await page.goto("/todos?view=list");
    await page.addStyleTag({ content: DOUBLED_TEXT_STYLE });

    const row = page.getByRole("link", { name: new RegExp(SHORT_TODO) });
    const badge = row.getByText("今日", { exact: true });
    await expect(badge).toBeVisible();
    expect(await overflowsContainer(badge), "状態ラベルが行からはみ出して隠れている").toBe(false);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("320px幅", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("最小幅でもツールバーとリスト行が横スクロールなく収まる", async ({ page }) => {
    await login(page);

    await page.goto("/todos");
    await expectNoHorizontalOverflow(page);

    await page.goto("/todos?view=list");
    const row = page.getByRole("link", { name: new RegExp(LONG_TODO) });
    await expect(row).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // 検索を開いても、入力欄が画面からはみ出さない。
    await page.getByLabel("Todoを検索").click();
    await expect(page.getByLabel("Todo名で検索")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  // 担当の絞り込みは選択中の家族名をそのまま表示する。上限の20文字でも
  // ツールバーが内容幅のまま広がらず、名前側を省略して画面に収める。
  test("上限の長さの家族名で絞り込んでもツールバーが画面からはみ出さない", async ({ page }) => {
    await login(page);
    await page.goto(`/todos?assignee=${LONG_NICKNAME_USER_ID}`);

    const toggle = await boxOf(
      page.getByText(`担当: ${LONG_NICKNAME}`, { exact: true }),
      "担当の絞り込み",
    );
    expect(toggle.x, "担当の絞り込みが画面の左外へ出ている").toBeGreaterThanOrEqual(0);
    expect(toggle.x + toggle.width, "担当の絞り込みが画面の右外へ出ている")
      .toBeLessThanOrEqual(320);
    await expectNoHorizontalOverflow(page);
  });
});
