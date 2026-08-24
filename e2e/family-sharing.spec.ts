import { expect, test, type Browser, type Page } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
const OUTSIDER = { email: "outsider@example.test", password: "outsider-password-value" };
let platform: PlatformProxy<CloudflareEnv>;

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
  ]);
}

async function seedAccounts(db: D1Database): Promise<void> {
  const [ownerHash, outsiderHash] = await Promise.all([
    hashPassword(OWNER.password),
    hashPassword(OUTSIDER.password),
  ]);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2), ('outsider', ?3, ?4)",
    ).bind(OWNER.email, ownerHash, OUTSIDER.email, outsiderHash),
    db.prepare(
      "INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん'), ('outsider', '別家庭さん')",
    ),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A'), ('household-b', '架空の家庭B')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner'), ('household-b', 'outsider')",
    ),
  ]);
}

async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(email);
  await loginRegion.getByLabel("パスワード").fill(password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await submitLoginForm(page, email, password);
  await expect(page).toHaveURL(/\/$/u);
}

async function issueInvitation(page: Page, email: string): Promise<string> {
  await page.goto("/household");
  await page.getByLabel("招待先メールアドレス").fill(email);
  await page.getByRole("button", { name: "招待する" }).click();
  const link = page.locator(".invitation-link-copy");
  await expect(link).toBeVisible();
  return (await link.textContent())?.trim() ?? "";
}

async function registerInvitee(browser: Browser, invitationLink: string): Promise<{
  context: Awaited<ReturnType<Browser["newContext"]>>;
  email: string;
  page: Page;
  password: string;
}> {
  const email = "invitee@example.test";
  const password = "invitee-password-value";
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invitationLink);
  await expect(page.getByRole("heading", { name: "招待からアカウントを作成" }))
    .toBeVisible();
  await page.getByLabel("ニックネーム").fill("家族Bさん");
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: "アカウントを作成して参加" }).click();
  await expect(page).toHaveURL(/\/$/u);
  return { context, email, page, password };
}

async function changeInviteePassword(
  page: Page,
  email: string,
  currentPassword: string,
): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await login(page, email, currentPassword);
  await page.goto("/account");
  const passwordRegion = page.getByRole("region", { name: "パスワード変更" });
  await passwordRegion.getByRole("button", { name: "パスワードを変更" }).click();
  const changedPassword = "changed-password-value";
  await passwordRegion.getByLabel("現在のパスワード").fill(currentPassword);
  await passwordRegion.getByLabel("新しいパスワード", { exact: true }).fill(changedPassword);
  await passwordRegion.getByLabel("新しいパスワード（確認）").fill(changedPassword);
  await passwordRegion.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/u);
  await login(page, email, changedPassword);
}

async function verifyOutsiderRejected(browser: Browser, ownerPage: Page): Promise<void> {
  const outsiderLink = await issueInvitation(ownerPage, OUTSIDER.email);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(outsiderLink);
  await expect(page).toHaveURL(/\/login\?next=/u);
  await submitLoginForm(page, OUTSIDER.email, OUTSIDER.password);
  await expect(page).toHaveURL(/\/invitations\/accept\/confirm$/u);
  await page.getByRole("button", { name: "招待を受諾する" }).click();
  await expect(platform.env.DB.prepare(
    "SELECT household_id FROM household_members WHERE user_id = 'outsider'",
  ).first()).resolves.toMatchObject({ household_id: "household-b" });
  await expect(platform.env.DB.prepare(
    "SELECT status FROM household_invitations WHERE invited_email = ?1 ORDER BY created_at DESC LIMIT 1",
  ).bind(OUTSIDER.email).first()).resolves.toMatchObject({ status: "pending" });
  await context.close();
}

test.beforeAll(async () => {
  platform = await getPlatformProxy<CloudflareEnv>({
    environment: E2E_WRANGLER_ENVIRONMENT,
    persist: true,
    remoteBindings: false,
  });
});

test.beforeEach(async () => {
  await clearDatabase(platform.env.DB);
  await seedAccounts(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("Auth.jsで招待限定登録・再ログイン・password変更を行い、別家庭を拒否する", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await login(ownerPage, OWNER.email, OWNER.password);

  const invitationLink = await issueInvitation(ownerPage, "invitee@example.test");
  expect(invitationLink).toMatch(/\/invitations\/accept#token=/u);
  const invitee = await registerInvitee(browser, invitationLink);

  await expect(platform.env.DB.prepare(
    `SELECT m.household_id, p.nickname
       FROM users u
       JOIN household_members m ON m.user_id = u.id
       JOIN profiles p ON p.user_id = u.id
      WHERE u.email = ?1`,
  ).bind(invitee.email).first()).resolves.toMatchObject({
    household_id: "household-a",
    nickname: "家族Bさん",
  });

  await changeInviteePassword(invitee.page, invitee.email, invitee.password);
  await verifyOutsiderRejected(browser, ownerPage);

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto("/account");
  await expect(anonymousPage).toHaveURL(/\/login/u);

  await Promise.all([
    ownerContext.close(),
    invitee.context.close(),
    anonymousContext.close(),
  ]);
});
