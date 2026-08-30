import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";

// 大分類は中黒を含む実際のラベル、詳しい種類は自由入力の上限に近い長さを使い、
// 連結表示に戻っていないことと、狭い画面でも折り返せることを同時に確かめる。
const KIND_LABEL = "支払い・手続き";
const LONG_ITEM_TYPE = "とても長い名前の詳しい種類サンプル文字列";
const ITEM_NAME = "2026年度 固定資産税";

let managedItemId: string;

// iPhone相当の幅。バッジを二つ並べても横スクロールが出ないことを確認する(#195)。
test.use({ viewport: { width: 390, height: 844 } });

async function seedOwnerWithClassifiedItem(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
  managedItemId = await createManagedItem(db, { userId: "owner" }, {
    customItemType: LONG_ITEM_TYPE,
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "obligation",
    name: ITEM_NAME,
    note: null,
    productInfo: null,
    startedOn: null,
  });
}

test.beforeEach(async ({ db }) => {
  await seedOwnerWithClassifiedItem(db);
});

test("モバイル幅の台帳一覧と詳細で大分類と詳しい種類が別々のバッジとして収まる", async ({
  page,
}) => {
  await login(page);

  for (const path of ["/managed-items", `/managed-items/${managedItemId}`]) {
    await page.goto(path);

    const badges = page.getByRole("list", { name: "分類" });
    await expect(badges.getByRole("listitem")).toHaveText([
      `大分類: ${KIND_LABEL}`,
      `詳しい種類: ${LONG_ITEM_TYPE}`,
    ]);

    // 二つのバッジが別々の列または行として置かれ、重なっていない。
    const kindBox = await badges.getByRole("listitem").first().boundingBox();
    const itemTypeBox = await badges.getByRole("listitem").last().boundingBox();
    if (kindBox === null || itemTypeBox === null) {
      throw new Error(`${path}でバッジが描画されていない`);
    }
    const separated =
      kindBox.x + kindBox.width <= itemTypeBox.x + 1
      || kindBox.y + kindBox.height <= itemTypeBox.y + 1;
    expect(separated, `${path}のバッジが重なっている`).toBe(true);

    // 390px幅で横スクロールが発生しない。
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, `${path}で横スクロールが発生している`).toBeLessThanOrEqual(0);
  }
});
