import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

// Issue #326: 登録の完了通知を登録ボタンの直下ではなく画面上部へ固定した。
// 「スクロール位置に関係なく確認できる」ことは、実際の描画と画面の高さが
// なければ確かめられないため、モバイル幅の実画面で見る。

test.use({ viewport: { height: 844, width: 390 } });

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test("フォーム下部で登録しても、完了通知が画面の中に見える", async ({ page }) => {
  await login(page);
  await page.goto("/todos/new");

  await page.getByLabel("Todo名").fill("換気扇の掃除");
  // 入力欄の多い「完了した日から繰り返す」を選び、フォームを長くする。
  await page.getByRole("radio", { name: "完了した日から繰り返す" }).check();
  await page.getByLabel("前回実施日", { exact: true }).fill("2026-09-01");

  const submit = page.getByRole("button", { name: "Todoを登録" });
  await submit.scrollIntoViewIfNeeded();
  await submit.click();

  const notice = page.getByRole("status").filter({ hasText: "Todoを登録しました。" });
  await expect(notice).toBeVisible();

  // 押した位置(フォーム下部)のままでも、通知は画面の中に収まっている。
  const box = await notice.boundingBox();
  if (box === null) throw new Error("通知の位置を取得できなかった");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  // スマホの画面を覆わない大きさに収める。
  expect(box.height).toBeLessThan(844 / 3);
  expect(box.width).toBeLessThanOrEqual(390 - 24);

  // 次回予定と一覧への導線も、その場で確認できる。
  await expect(notice.getByText(/次回|推奨期間|予定日/u)).toBeVisible();
  await expect(notice.getByRole("link", { name: "登録したTodoを一覧で確認" }))
    .toHaveAttribute("href", "/todos");

  // 通知が出ていても操作はブロックされない(モーダルにしていない)。
  await page.getByLabel("Todo名").fill("浴室の換気");
  await expect(page.getByLabel("Todo名")).toHaveValue("浴室の換気");

  await page.getByRole("button", { name: "登録の通知を閉じる" }).click();
  await expect(notice).toHaveCount(0);
});
