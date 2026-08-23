import { expect, test, type Page } from "@playwright/test";

import {
  PREVIEW_E2E_INVITEE_EMAIL,
  PREVIEW_E2E_OUTSIDER_HOUSEHOLD_NAME,
} from "../../lib/e2e/preview-fixtures";
import {
  resetPreviewE2eFixtures,
  type PreviewE2eFixtures,
} from "../../scripts/e2e-admin-remote";

const OWNER_NICKNAME = "E2Eオーナー";
const INVITEE_NICKNAME = "E2E招待者";
const INVITEE_PASSWORD = "e2e-invitee-password-value";
const TODO_TITLE = "E2E確認用Todo";

let fixtures: PreviewE2eFixtures;

test.beforeAll(async () => {
  fixtures = await resetPreviewE2eFixtures();
});

// 呼び出し時点のページが既に/login(招待受諾からのredirectで?next=付き
// のことがある)であることを前提にする。ここでpage.goto("/login")すると
// ?nextが消え、ログイン後に元の招待確認画面へ戻れなくなる。
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

function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

// owner側の初回セットアップ導線。preview D1にはこの実行の直前に
// resetPreviewE2eFixturesがニックネーム・家庭とも未作成のownerを作る。
async function setUpOwner(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByLabel("ニックネーム", { exact: true }).fill(OWNER_NICKNAME);
  await page.getByRole("button", { name: "ニックネームを登録" }).click();
  // registerNicknameは成功時に/householdへserver側redirectする。
  await expect(page).toHaveURL(/\/household$/u);

  await page.getByRole("button", { name: "家庭を作成" }).click();
  await expect(page.getByText(`${OWNER_NICKNAME}の家庭`)).toBeVisible();
}

async function createAndCompleteTodo(page: Page): Promise<void> {
  await page.goto("/todos/new");
  await page.getByLabel("Todo名").fill(TODO_TITLE);
  await page.getByLabel("予定日").fill(todayInTokyo());
  await page.getByRole("button", { name: "Todoを登録" }).click();
  await expect(page.getByText("Todoを登録しました。")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: `${TODO_TITLE}を記録` }).click();
  await page.getByRole("button", { name: "今、自分がやった" }).click();
  await expect(
    page.getByRole("button", { name: `${TODO_TITLE}を記録` }),
  ).toBeHidden();
}

async function issueInvitation(page: Page, email: string): Promise<string> {
  await page.goto("/household");
  await page.getByLabel("招待先メールアドレス").fill(email);
  await page.getByRole("button", { name: "招待する" }).click();
  const link = page.locator(".invitation-link-copy");
  await expect(link).toBeVisible();
  return (await link.textContent())?.trim() ?? "";
}

async function acceptInvitationAsNewUser(
  page: Page,
  invitationLink: string,
): Promise<void> {
  await page.goto(invitationLink);
  await expect(
    page.getByRole("heading", { name: "招待からアカウントを作成" }),
  ).toBeVisible();
  await page.getByLabel("ニックネーム").fill(INVITEE_NICKNAME);
  await page.getByLabel("パスワード", { exact: true }).fill(INVITEE_PASSWORD);
  await page.getByLabel("パスワード（確認）").fill(INVITEE_PASSWORD);
  await page.getByRole("button", { name: "アカウントを作成して参加" }).click();
  await expect(page).toHaveURL(/\/$/u);
}

// すでに別の家庭(outsiderの家庭)に所属しているアカウントは、ownerからの
// 招待を受諾できない(YDR-020「一人一家庭」)。UIから見える結果だけで
// 判定する(previewには直接D1アクセスしないため)。
async function verifyOutsiderCannotJoin(
  page: Page,
  invitationLink: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(invitationLink);
  await expect(page).toHaveURL(/\/login\?next=/u);
  await submitLoginForm(page, email, password);
  await expect(page).toHaveURL(/\/invitations\/accept\/confirm$/u);
  await expect(
    page.getByRole("heading", { name: "家族からの招待です" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "招待を受諾する" }).click();
  await expect(
    page.getByText(
      "この招待リンクは無効か、有効期限が切れています。招待した家族に再発行を依頼してください。",
      { exact: true },
    ),
  ).toBeVisible();

  await page.goto("/household");
  await expect(
    page.getByText(PREVIEW_E2E_OUTSIDER_HOUSEHOLD_NAME, { exact: true }),
  ).toBeVisible();
}

test("preview上でログイン・招待受諾・家庭間分離・完了操作を確認する(#151)", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await login(ownerPage, fixtures.ownerEmail, fixtures.ownerPassword);
  await setUpOwner(ownerPage);
  await createAndCompleteTodo(ownerPage);

  const inviteeLink = await issueInvitation(ownerPage, PREVIEW_E2E_INVITEE_EMAIL);
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await acceptInvitationAsNewUser(inviteePage, inviteeLink);
  await expect(inviteePage.getByText(TODO_TITLE)).toBeVisible();

  const outsiderLink = await issueInvitation(ownerPage, fixtures.outsiderEmail);
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await verifyOutsiderCannotJoin(
    outsiderPage,
    outsiderLink,
    fixtures.outsiderEmail,
    fixtures.outsiderPassword,
  );

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto("/account");
  await expect(anonymousPage).toHaveURL(/\/login/u);

  await Promise.all([
    ownerContext.close(),
    inviteeContext.close(),
    outsiderContext.close(),
    anonymousContext.close(),
  ]);
});
