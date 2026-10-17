import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

// Issue #226 / YDR-048: 登録フォームでタグを作って付け、別の管理対象で同じ
// タグを選び、一覧・詳細で分類とは別に確認し、編集で外せることを実画面で確かめる。
// iPhone相当の幅で、タグのチップとバッジが横スクロールを出さないことも見る。
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

async function expectNoHorizontalScroll(page: import("@playwright/test").Page, label: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow, `${label}で横スクロールが発生している`).toBeLessThanOrEqual(0);
}

async function registerServiceItem(
  page: import("@playwright/test").Page,
  name: string,
  fillTags: (group: import("@playwright/test").Locator) => Promise<void>,
): Promise<void> {
  await page.goto("/managed-items/new");
  await page.getByLabel("名前").fill(name);
  await page.getByLabel("大分類").selectOption("service");
  await fillTags(page.getByRole("group", { name: "タグ（任意）" }));
  await page.getByRole("button", { name: "管理対象を登録" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("登録でタグを作って複数の管理対象で共有し、一覧・詳細で確認して編集で外せる", async ({
  page,
}) => {
  await login(page);

  await registerServiceItem(page, "○○デイ", async (group) => {
    await group.getByLabel("新しいタグ").fill("子どもA、送迎あり");
  });
  const firstDetailUrl = page.url();
  await expect(page.getByRole("list", { name: "タグ" }).getByRole("listitem"))
    .toHaveText(["#タグ: 子どもA", "#タグ: 送迎あり"]);
  await expect(page.getByRole("list", { name: "分類" }).getByRole("listitem"))
    .toHaveText(["大分類: サービス・契約"]);

  await registerServiceItem(page, "△△デイ", async (group) => {
    await group.getByRole("checkbox", { name: "子どもA" }).check();
  });
  await expect(page.getByRole("list", { name: "タグ" }).getByRole("listitem"))
    .toHaveText(["#タグ: 子どもA"]);
  await expectNoHorizontalScroll(page, "詳細");

  await page.goto("/managed-items?kind=service");
  for (const name of ["○○デイ", "△△デイ"]) {
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name }) });
    await expect(row.getByRole("list", { name: "タグ" })).toContainText("子どもA");
  }
  await expectNoHorizontalScroll(page, "一覧");

  await page.goto(`${firstDetailUrl}/edit`);
  const group = page.getByRole("group", { name: "タグ（任意）" });
  await expect(group.getByRole("checkbox", { name: "子どもA" })).toBeChecked();
  await expect(group.getByRole("checkbox", { name: "送迎あり" })).toBeChecked();
  await group.getByRole("checkbox", { name: "送迎あり" }).uncheck();
  await expectNoHorizontalScroll(page, "編集");
  await page.getByRole("button", { name: "変更を保存" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "○○デイ" })).toBeVisible();
  await expect(page.getByRole("list", { name: "タグ" }).getByRole("listitem"))
    .toHaveText(["#タグ: 子どもA"]);
});
