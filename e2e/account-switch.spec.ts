import { hashPassword } from "../src/lib/auth/password";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

for (const signOutFirst of [true, false]) {
  test(`${signOutFirst ? "ログアウトして" : "ログイン画面から直接"}家族を切り替えると本人のメールと名前が両方切り替わる`, async ({ db, page }) => {
    await seedOwnerHousehold(db);
    const member = { email: "member@example.test", password: "member-password-value" };
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('member', ?1, ?2)")
        .bind(member.email, await hashPassword(member.password)),
      db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('member', '家族Bさん')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'member')"),
    ]);

    await login(page);
    await page.goto("/account");
    await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
    await expect(page.getByText("家族Aさん", { exact: true })).toBeVisible();
    if (signOutFirst) {
      await page.getByRole("button", { name: "設定メニュー" }).click();
      await page.getByRole("button", { name: "ログアウト", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/u);
      await page.goto("/account");
      await expect(page).toHaveURL(/\/login(?:\?|$)/u);
    }

    await login(page, member);
    await page.goto("/account");
    await expect(page.getByText(member.email, { exact: true })).toBeVisible();
    await expect(page.getByText("家族Bさん", { exact: true })).toBeVisible();
    await expect(page.getByText("家族Aさん", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(member.email, { exact: true })).toBeVisible();
    await expect(page.getByText("家族Bさん", { exact: true })).toBeVisible();

    // /loginへ直接進んだ場合も、成功した再認証で前のprincipalを置き換える。
    await login(page);
    await page.goto("/account");
    await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
    await expect(page.getByText("家族Aさん", { exact: true })).toBeVisible();
    await expect(page.getByText("家族Bさん", { exact: true })).toHaveCount(0);
  });
}
