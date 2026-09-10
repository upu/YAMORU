import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("追加ボタンが下部ナビゲーションの上にあり、画面ごとに行き先が変わる", async ({
    page,
  }) => {
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

    await navigation.getByRole("link", { name: "Todo" }).click();
    await expect(page.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );

    await navigation.getByRole("link", { name: "台帳" }).click();
    // Issue #391: 一覧の追加は、見出しの中のリンクと同じ文言で右下へ出す。
    const ledgerAdd = page.getByRole("link", { name: "備品を登録" });
    await expect(ledgerAdd).toHaveAttribute("href", "/managed-items/new");
    await ledgerAdd.click();
    await expect(page).toHaveURL(/\/managed-items\/new$/u);
    await expect(page.getByRole("link", { name: "備品を登録" })).toHaveCount(0);
  });

  // Issue #391: 同じ追加操作を同一画面に2か所出さない。モバイル幅では見出しの
  // 中のリンクを出さず、右下のボタンだけを主要導線にする。
  test("一覧の追加導線は右下のボタンだけで、見出しの中には出さない", async ({ page }) => {
    await login(page);

    for (const path of ["/todos", "/managed-items", "/consumables"]) {
      await page.goto(path);
      const label = { "/consumables": "消耗品を登録", "/managed-items": "備品を登録", "/todos": "Todoを追加" }[path] ?? "";
      const addLinks = page.getByRole("link", { name: label });
      await expect(addLinks).toHaveCount(1);
      const box = await addLinks.boundingBox();
      expect(box).not.toBeNull();
      // 右下に固定したボタンなので、画面の右端側にある。
      expect(box?.x ?? 0).toBeGreaterThan(390 / 2);
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

    const lists: { label: string; path: string }[] = [
      { label: "Todoを追加", path: "/todos" },
      { label: "備品を登録", path: "/managed-items" },
      { label: "消耗品を登録", path: "/consumables" },
    ];
    for (const list of lists) {
      await page.goto(list.path);
      const addLink = page.getByRole("link", { name: list.label });
      await expect(addLink).toHaveCount(1);
      await expect(addLink).toBeVisible();
      const box = await addLink.boundingBox();
      expect(box).not.toBeNull();
      // 右下の固定ボタンではなく、本文の中の行に並んでいる。
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(900 - 100);
    }
  });
});
