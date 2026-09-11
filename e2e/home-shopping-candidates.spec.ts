import { type Locator, type Page } from "@playwright/test";

import { E2E_OWNER_USER_ID, expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { setConsumablePinned } from "../src/lib/d1/consumable-pins";
import { createConsumable, updateConsumableStockStatus } from "../src/lib/d1/consumables";

// Issue #398: ホームの「買っておきたいもの」は1件ずつ枠で囲んだ表示で、件数が
// 増えるとホーム上で大きな領域を占めていた。ピン留めと同じ密度の一覧に寄せた
// ことは、実際の描画で1件あたりの高さを測らないと確かめられない。

const CANDIDATE_NAMES = ["食洗機用洗剤", "交換フィルター", "トイレットペーパー"];
const PIN_NAMES = ["猫のトイレ砂", "ゴミ袋", "乾電池"];

async function seedConsumable(db: D1Database, name: string): Promise<string> {
  return createConsumable(db, { userId: E2E_OWNER_USER_ID }, {
    externalUrl: null,
    managedItemIds: [],
    name,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
}

function shoppingSection(page: Page): Locator {
  return page.getByRole("region", { name: "買っておきたいもの" });
}

function pinnedSection(page: Page): Locator {
  return page.getByRole("region", { name: "ピン留め" });
}

async function heightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("位置を取得できなかった");
  return box.height;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  const session = { userId: E2E_OWNER_USER_ID };
  // 在庫が「少ない」「ない」の消耗品が買い物候補になる。
  for (const [index, name] of CANDIDATE_NAMES.entries()) {
    const id = await seedConsumable(db, name);
    await updateConsumableStockStatus(db, session, id, index === 0 ? "out" : "low");
  }
  // 並べたときの密度を比べるため、在庫「ある」のままピン留めだけを作る。
  for (const name of PIN_NAMES) {
    const id = await seedConsumable(db, name);
    await setConsumablePinned(db, session, id, true);
  }
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("買い物候補は1件ずつ枠で囲まず、ピン留めと同じ1件あたりの高さで並ぶ", async ({
    page,
  }) => {
    await login(page);

    const rows = shoppingSection(page).getByRole("listitem");
    await expect(rows).toHaveCount(CANDIDATE_NAMES.length);

    // 行と行の間に隙間を作らず、区切り線(1px)だけでつなぐ。1件ずつの枠なら、
    // 枠の間隔ぶん次の行の上端が離れる。
    const boxes = await Promise.all(
      Array.from({ length: CANDIDATE_NAMES.length }, async (_unused, index) => {
        const box = await rows.nth(index).boundingBox();
        if (box === null) throw new Error("位置を取得できなかった");
        return box;
      }),
    );
    for (const [index, box] of boxes.slice(1).entries()) {
      const gap = box.y - (boxes[index].y + boxes[index].height);
      expect(gap).toBeGreaterThanOrEqual(0);
      // 区切り線の1pxと、小数の丸めぶんだけ。
      expect(gap).toBeLessThanOrEqual(2);
    }

    // ピン留めの1件と同じ高さにそろえる(どちらも押せる高さ--tap-target=44px)。
    const pinHeight = await heightOf(pinnedSection(page).getByRole("article").first());
    expect(Math.round(boxes[0].height)).toBe(Math.round(pinHeight));

    // 同じ件数なら、セクション全体の高さもピン留めとほぼ同じになる。
    const shoppingHeight = await heightOf(shoppingSection(page));
    const pinnedHeight = await heightOf(pinnedSection(page));
    expect(Math.abs(shoppingHeight - pinnedHeight)).toBeLessThanOrEqual(4);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("名前と在庫状態は残り、名前から消耗品の詳細へ移動できる", async ({ page }) => {
    await login(page);

    const section = shoppingSection(page);
    // 「少ない」も「ない」を含むため、完全一致で数える。
    await expect(section.getByText("ない", { exact: true })).toHaveCount(1);
    await expect(section.getByText("少ない", { exact: true })).toHaveCount(2);
    // 毎回読む必要のない説明文は置かない(各行のバッジが同じことを示す)。
    await expect(section.getByText("残りが少ない、または切れている消耗品です"))
      .toHaveCount(0);

    await section.getByRole("link", { exact: true, name: CANDIDATE_NAMES[0] }).click();
    await expect(page).toHaveURL(/\/consumables\/[^/]+$/u);
    await expect(page.getByRole("heading", { level: 1, name: CANDIDATE_NAMES[0] }))
      .toBeVisible();
  });
});

test.describe("最小幅(320px)", () => {
  test.use({ viewport: { height: 720, width: 320 } });

  test("長い名前でも在庫状態を次の行へ送らず、横スクロールも出さない", async ({
    page,
    db,
  }) => {
    // 消耗品名の上限は100文字(src/app/consumables/actions.ts)。最小幅で
    // いちばん厳しくなる長さを、実際に登録できる範囲で確かめる。
    const longName = "詰め替え用の".repeat(6);
    const id = await seedConsumable(db, longName);
    await updateConsumableStockStatus(db, { userId: E2E_OWNER_USER_ID }, id, "low");

    await login(page);

    const row = shoppingSection(page).getByRole("listitem")
      .filter({ hasText: longName });
    const name = await row.getByRole("link").boundingBox();
    const badge = await row.getByText("少ない").boundingBox();
    if (name === null || badge === null) throw new Error("位置を取得できなかった");

    // 名前の側だけが折り返し、在庫状態は同じ行の右端に残る。
    expect(badge.x).toBeGreaterThan(name.x + name.width - 1);
    expect(badge.y).toBeGreaterThanOrEqual(name.y);
    expect(badge.y + badge.height).toBeLessThanOrEqual(name.y + name.height + 1);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
