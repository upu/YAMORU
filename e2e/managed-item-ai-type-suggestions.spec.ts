import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

// Issue #332: AI提案は入力補助であり、使えない環境でも登録は止まらない。
// ローカルE2E(wrangler env e2e)にはWorkers AIのバインディングを置いていない
// ため、この構成そのものが「AIを利用できない環境」の確認になる。

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test("AIを利用できない環境でも案内を出すだけで、これまでどおり登録できる", async ({
  page,
}) => {
  await login(page);
  await page.goto("/managed-items/new");
  await page.getByLabel("名前").fill("デロンギ マグニフィカS");

  await page.getByRole("button", { name: "詳しい種類の候補を考えてもらう" }).click();
  await expect(
    page.getByText("いまは候補を出せません。これまでどおり自分で入力できます。"),
  ).toBeVisible();

  // 候補が出なくても、#288までの入力補助と手入力はそのまま使える。
  await page.getByLabel("詳しい種類（任意）").selectOption("__custom__");
  await page.getByLabel("詳しい種類を入力").fill("全自動コーヒーマシン");
  await page.getByRole("button", { name: "管理対象を登録" }).click();

  await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);
  await expect(page.getByText("全自動コーヒーマシン").first()).toBeVisible();
});

test("名前が未入力のときは、先に名前を入れるよう案内する", async ({ page }) => {
  await login(page);
  await page.goto("/managed-items/new");

  await page.getByRole("button", { name: "詳しい種類の候補を考えてもらう" }).click();

  await expect(page.getByText("先に名前を入力すると候補を出せます。")).toBeVisible();
});
