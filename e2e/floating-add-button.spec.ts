import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

const LISTS = [
  { label: "Todoを追加", navigationLabel: "Todo", newPath: "/todos/new", path: "/todos" },
  { label: "備品を登録", navigationLabel: "台帳", newPath: "/managed-items/new", path: "/managed-items" },
  { label: "消耗品を登録", navigationLabel: null, newPath: "/consumables/new", path: "/consumables" },
];

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("ホームの追加ボタンが下部ナビゲーションの上にある", async ({ page }) => {
    await login(page);

    const todoAdd = page.getByRole("link", { name: "Todoを追加" });
    const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
    await expect(todoAdd).toBeVisible();
    await expect(todoAdd).toHaveText("＋");
    const [todoAddBox, navigationBox] = await Promise.all([
      todoAdd.boundingBox(),
      navigation.boundingBox(),
    ]);
    expect(todoAddBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect((todoAddBox?.y ?? 0) + (todoAddBox?.height ?? 0))
      .toBeLessThanOrEqual((navigationBox?.y ?? 0) - 15);
  });

  // Issue #391: 同じ追加操作を同一画面に2か所出さない。モバイル幅では見出しの
  // 中のリンクを出さず、右下のボタンだけを主要導線にする。
  test("一覧の追加導線は右下の1か所だけで、各登録画面へ進める", async ({ page }) => {
    await login(page);

    const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
    for (const list of LISTS) {
      await test.step(list.label, async () => {
        if (list.navigationLabel === null) {
          await page.goto(list.path);
        } else {
          await navigation.getByRole("link", { name: list.navigationLabel }).click();
        }
        const addLink = page.getByRole("link", { name: list.label });
        await expect(addLink).toHaveCount(1);
        await expect(addLink).toHaveAttribute("href", list.newPath);
        const box = await addLink.boundingBox();
        expect(box).not.toBeNull();
        // 右下に固定したボタンなので、画面の右端側にある。
        expect(box?.x ?? 0).toBeGreaterThan(390 / 2);

        await addLink.click();
        await expect(page).toHaveURL(new RegExp(`${list.newPath}$`, "u"));
        await expect(page.getByRole("link", { name: list.label })).toHaveCount(0);
      });
    }
  });
});

test.describe("PC幅", () => {
  test.use({ viewport: { height: 900, width: 1280 } });

  test("ホームでは追加ボタンを画面右下に固定する", async ({ page }) => {
    await login(page);

    const addButton = page.getByRole("link", { name: "Todoを追加" });
    await expect(addButton).toHaveText("＋");
    const box = await addButton.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(1280 - ((box?.x ?? 0) + (box?.width ?? 0)) - 24))
      .toBeLessThanOrEqual(1);
    expect(Math.abs(900 - ((box?.y ?? 0) + (box?.height ?? 0)) - 24))
      .toBeLessThanOrEqual(1);
  });

  // Issue #391: モバイル幅より広い画面では、一覧の追加は見出しの中のリンクだけに
  // する。右下のボタンはdisplay: noneなので、支援技術からも見えない。
  test("一覧の追加導線は見出しの中のリンクだけで、右下のボタンは出さない", async ({ page }) => {
    await login(page);

    for (const list of LISTS) {
      await test.step(list.label, async () => {
        await page.goto(list.path);
        const addLink = page.getByRole("link", { name: list.label });
        await expect(addLink).toHaveCount(1);
        await expect(addLink).toBeVisible();
        const box = await addLink.boundingBox();
        expect(box).not.toBeNull();
        // 右下の固定ボタンではなく、本文の中の行に並んでいる。
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(900 - 100);
      });
    }
  });
});
