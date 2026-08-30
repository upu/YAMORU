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
    const ledgerAdd = page.getByRole("link", { name: "台帳に追加" });
    await expect(ledgerAdd).toHaveAttribute("href", "/managed-items/new");
    await ledgerAdd.click();
    await expect(page).toHaveURL(/\/managed-items\/new$/u);
    await expect(page.getByRole("link", { name: "台帳に追加" })).toHaveCount(0);
  });
});

test.describe("PC幅", () => {
  test.use({ viewport: { height: 900, width: 1280 } });

  test("追加ボタンを画面右下に固定する", async ({ page }) => {
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
});
