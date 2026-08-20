import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { INVITE_CLAIM_COOKIE_NAME } from "../lib/invitations/claim-cookie.ts";
import type { Database } from "../lib/supabase/database.types.ts";
import { getE2ETestEnvironment } from "../scripts/e2e-environment.ts";

type Credentials = { email: string; password: string };
type ApiClient = SupabaseClient<Database>;
type UserSession = {
  client: ApiClient;
  context: BrowserContext;
  nickname: string;
  page: Page;
  userId: string;
};
type SharedFixture = {
  calendarRuleId: string;
  itemId: string;
  itemName: string;
  maintenanceOccurrenceId: string;
  maintenanceRuleId: string;
  maintenanceTitle: string;
  oneTimeOccurrenceId: string;
  oneTimeRuleId: string;
  oneTimeTitle: string;
};
type Scenario = {
  invitee: UserSession;
  outsider: UserSession;
  owner: UserSession;
  suffix: string;
};

const environment = getE2ETestEnvironment();
const authOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};

function credentials(label: string, suffix: string): Credentials {
  return {
    email: `yamoru-e2e-${label}-${suffix}@example.test`,
    password: `local-e2e-${suffix}`,
  };
}

function newApiClient(): ApiClient {
  return createClient<Database>(
    environment.supabaseUrl,
    environment.publishableKey,
    authOptions,
  );
}

async function submitSignup(page: Page, account: Credentials): Promise<void> {
  const signup = page.getByRole("region", { name: "新規登録" });
  await signup.getByLabel("メールアドレス").fill(account.email);
  await signup.getByLabel("パスワード").fill(account.password);
  await signup.getByRole("button", { name: "新規登録" }).click();
}

async function registerProfile(
  page: Page,
  account: Credentials,
  nickname: string,
  householdName?: string,
): Promise<void> {
  await page.goto("/login");
  await submitSignup(page, account);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await page.getByRole("textbox", { name: "ニックネーム" }).fill(nickname);
  await page.getByRole("button", { name: "ニックネームを登録" }).click();
  if (householdName === undefined) return;
  await page.getByLabel("家庭名").fill(householdName);
  await page.getByRole("button", { name: "家庭を作成" }).click();
  await expect(page.getByRole("heading", { name: "所属している家庭" })).toBeVisible();
}

async function connectApi(account: Credentials): Promise<{ client: ApiClient; userId: string }> {
  const client = newApiClient();
  const result = await client.auth.signInWithPassword(account);
  expect(result.error).toBeNull();
  const userId = result.data.user?.id;
  if (userId === undefined) throw new Error("E2E利用者IDを取得できませんでした。");
  return { client, userId };
}

async function registeredSession(
  browser: Browser,
  account: Credentials,
  nickname: string,
  householdName?: string,
): Promise<UserSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await registerProfile(page, account, nickname, householdName);
  const { client, userId } = await connectApi(account);
  return { client, context, nickname, page, userId };
}

async function issueInvitation(owner: Page, invitedEmail: string): Promise<string> {
  await owner.goto("/account/invitations");
  await owner.getByLabel("招待先メールアドレス").fill(invitedEmail);
  await owner.getByRole("button", { name: "招待する" }).click();
  const link = owner.locator(".invitation-link-copy");
  await expect(link).toBeVisible();
  return (await link.textContent())?.trim() ?? "";
}

async function acceptInvitation(
  browser: Browser,
  link: string,
  account: Credentials,
  nickname: string,
): Promise<UserSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect((await context.cookies()).map(({ name }) => name)).toContain(
    INVITE_CLAIM_COOKIE_NAME,
  );
  await submitSignup(page, account);
  await expect(page).toHaveURL(/\/invitations\/accept\/confirm$/);
  expect((await context.cookies()).map(({ name }) => name)).toContain(
    INVITE_CLAIM_COOKIE_NAME,
  );
  await expect(page.getByRole("heading", { name: "ニックネーム登録" })).toBeVisible();
  await page.getByRole("textbox", { name: "ニックネーム" }).fill(nickname);
  await page.getByRole("button", { name: "ニックネームを登録" }).click();
  await page.getByRole("button", { name: "招待を受諾する" }).click();
  await expect(page).toHaveURL(/\/$/);
  const { client, userId } = await connectApi(account);
  return { client, context, nickname, page, userId };
}

async function setupScenario(browser: Browser): Promise<Scenario> {
  const suffix = crypto.randomUUID();
  const ownerAccount = credentials("owner", suffix);
  const inviteeAccount = credentials("invitee", suffix);
  const outsiderAccount = credentials("outsider", suffix);
  const owner = await registeredSession(browser, ownerAccount, "家族Aさん", `架空の家庭A-${suffix}`);
  const link = await issueInvitation(owner.page, inviteeAccount.email);
  expect(link).toMatch(/^http:\/\/localhost:3000\/invitations\/accept\?token=/);
  const invitee = await acceptInvitation(browser, link, inviteeAccount, "家族Bさん");
  const outsider = await registeredSession(
    browser,
    outsiderAccount,
    "別家庭さん",
    `架空の家庭B-${suffix}`,
  );
  return { invitee, outsider, owner, suffix };
}

function tokyoDateAfter(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function createManagedItem(page: Page, name: string): Promise<string> {
  await page.goto("/managed-items");
  await page.getByLabel("名前").fill(name);
  await page.getByRole("button", { name: "管理対象を登録" }).click();
  await expect(page).toHaveURL(/\/managed-items\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

async function registerUiTodo(options: {
  managedItemId?: string;
  page: Page;
  recurrence: "calendar" | "once";
  title: string;
}): Promise<void> {
  const { managedItemId, page, recurrence, title } = options;
  await page.goto(`/todos/new${managedItemId === undefined ? "" : `?managedItemId=${managedItemId}`}`);
  await page.getByLabel("Todo名").fill(title);
  if (recurrence === "once") {
    await page.getByRole("radio", { name: "繰り返しなし" }).check();
    await page.getByLabel("予定日").fill(tokyoDateAfter(1));
  } else {
    await page.getByRole("radio", { name: "曜日・日付で繰り返す" }).check();
  }
  await page.getByRole("button", { name: "Todoを登録" }).click();
  await expect(page.getByText("Todoを登録しました。")).toBeVisible();
}

async function ruleAndOccurrence(
  client: ApiClient,
  title: string,
): Promise<{ occurrenceId: string; ruleId: string }> {
  const result = await client
    .from("task_rules")
    .select("id, task_occurrences(id)")
    .eq("title", title)
    .single();
  expect(result.error).toBeNull();
  const occurrenceId = result.data?.task_occurrences[0]?.id;
  if (result.data === null || occurrenceId === undefined) {
    throw new Error(`${title}のRuleまたはOccurrenceを取得できませんでした。`);
  }
  return { occurrenceId, ruleId: result.data.id };
}

async function createSharedFixture(scenario: Scenario): Promise<SharedFixture> {
  const itemName = `共有給水機-${scenario.suffix}`;
  const oneTimeTitle = `一回限り共有Todo-${scenario.suffix}`;
  const calendarTitle = `定例日共有Todo-${scenario.suffix}`;
  const maintenanceTitle = `同時完了Todo-${scenario.suffix}`;
  const itemId = await createManagedItem(scenario.owner.page, itemName);
  await registerUiTodo({ page: scenario.owner.page, recurrence: "once", title: oneTimeTitle });
  await registerUiTodo({
    managedItemId: itemId,
    page: scenario.owner.page,
    recurrence: "calendar",
    title: calendarTitle,
  });
  const now = Date.now();
  const maintenance = await scenario.owner.client.rpc("create_maintenance_task", {
    first_due_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
    first_scheduled_for: new Date(now).toISOString(),
    item_id: itemId,
    recommended_start_offset: 0,
    recommended_until_offset: 2,
    task_title: maintenanceTitle,
  });
  expect(maintenance.error).toBeNull();
  const [oneTime, calendar, maintenanceIds] = await Promise.all([
    ruleAndOccurrence(scenario.owner.client, oneTimeTitle),
    ruleAndOccurrence(scenario.owner.client, calendarTitle),
    ruleAndOccurrence(scenario.owner.client, maintenanceTitle),
  ]);
  return {
    calendarRuleId: calendar.ruleId,
    itemId,
    itemName,
    maintenanceOccurrenceId: maintenanceIds.occurrenceId,
    maintenanceRuleId: maintenanceIds.ruleId,
    maintenanceTitle,
    oneTimeOccurrenceId: oneTime.occurrenceId,
    oneTimeRuleId: oneTime.ruleId,
    oneTimeTitle,
  };
}

function taskCard(page: Page, title: string) {
  return page.locator("article.task-card").filter({ hasText: title });
}

function detailTodo(page: Page, title: string) {
  return page.locator(".maintenance-todo-list > li").filter({ hasText: title });
}

async function completeOneTimeAndRefresh(scenario: Scenario, fixture: SharedFixture): Promise<void> {
  await scenario.invitee.page.goto("/");
  await expect(taskCard(scenario.invitee.page, fixture.oneTimeTitle)).toBeVisible();
  await scenario.owner.page.goto("/");
  const ownerCard = taskCard(scenario.owner.page, fixture.oneTimeTitle);
  await ownerCard.getByRole("button", { name: `${fixture.oneTimeTitle}を記録` }).click();
  await scenario.owner.page.getByRole("button", { name: "今、自分がやった" }).click();
  await expect.poll(async () => {
    const result = await scenario.owner.client
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("task_occurrence_id", fixture.oneTimeOccurrenceId)
      .eq("action", "completed");
    return result.count;
  }).toBe(1);
  await scenario.invitee.page.waitForTimeout(2100);
  await scenario.invitee.page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(taskCard(scenario.invitee.page, fixture.oneTimeTitle)).toContainText("完了");
}

async function changeAssignmentAndPostpone(scenario: Scenario, fixture: SharedFixture): Promise<void> {
  const detailPath = `/managed-items/${fixture.itemId}`;
  await scenario.invitee.page.goto(detailPath);
  await scenario.owner.page.goto(detailPath);
  const ownerTodo = detailTodo(scenario.owner.page, fixture.maintenanceTitle);
  await ownerTodo.getByLabel(`${fixture.maintenanceTitle}の担当`).selectOption({
    label: scenario.invitee.nickname,
  });
  await expect(ownerTodo.getByLabel(`${fixture.maintenanceTitle}の担当`)).toHaveValue(
    scenario.invitee.userId,
  );
  await ownerTodo.getByRole("button", { name: `${fixture.maintenanceTitle}を延期する` }).click();
  await scenario.owner.page.getByLabel("実施する予定の新しい期限").fill(tokyoDateAfter(4));
  await scenario.owner.page.getByRole("button", { name: "この日まで延期する" }).click();
  await expect(scenario.owner.page.getByText(/まで延期しました/)).toBeVisible();
  await scenario.invitee.page.waitForTimeout(2100);
  await scenario.invitee.page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  const inviteeTodo = detailTodo(scenario.invitee.page, fixture.maintenanceTitle);
  await expect(inviteeTodo.getByLabel(`${fixture.maintenanceTitle}の担当`)).toHaveValue(
    scenario.invitee.userId,
  );
  const [, month, day] = tokyoDateAfter(4).split("-").map(Number);
  await expect(inviteeTodo).toContainText(`${String(month)}月${String(day)}日`);
}

async function completeConcurrently(scenario: Scenario, fixture: SharedFixture): Promise<void> {
  const detailPath = `/managed-items/${fixture.itemId}`;
  await Promise.all([scenario.owner.page.goto(detailPath), scenario.invitee.page.goto(detailPath)]);
  await Promise.all(
    [scenario.owner.page, scenario.invitee.page].map(async (page) => {
      await detailTodo(page, fixture.maintenanceTitle)
        .getByRole("button", { name: `${fixture.maintenanceTitle}を記録` })
        .click();
    }),
  );
  await Promise.all(
    [scenario.owner.page, scenario.invitee.page].map((page) =>
      page.getByRole("button", { name: "今、自分がやった" }).click()
    ),
  );
  await expect.poll(async () => {
    const result = await scenario.owner.client
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("task_occurrence_id", fixture.maintenanceOccurrenceId)
      .eq("action", "completed");
    return result.count;
  }).toBe(1);
  const occurrences = await scenario.owner.client
    .from("task_occurrences")
    .select("id, status")
    .eq("task_rule_id", fixture.maintenanceRuleId);
  expect(occurrences.error).toBeNull();
  expect(occurrences.data?.filter(({ status }) => status === "pending")).toHaveLength(1);
  await scenario.invitee.page.reload();
  await expect(scenario.invitee.page.getByRole("heading", { name: "直近の完了" })).toBeVisible();
  await expect(scenario.invitee.page.getByText(fixture.maintenanceTitle, { exact: true }).first()).toBeVisible();
}

async function expectRpcError(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const result = await promise;
  expect(result.error).not.toBeNull();
}

async function nextOccurrenceId(scenario: Scenario, fixture: SharedFixture): Promise<string> {
  const pending = await scenario.owner.client
    .from("task_occurrences")
    .select("id")
    .eq("task_rule_id", fixture.maintenanceRuleId)
    .eq("status", "pending")
    .single();
  expect(pending.error).toBeNull();
  if (pending.data === null) throw new Error("次回Occurrenceを取得できませんでした。");
  return pending.data.id;
}

async function verifyMutationIsolation(
  scenario: Scenario,
  fixture: SharedFixture,
  occurrenceId: string,
): Promise<void> {
  await expectRpcError(
    scenario.owner.client.rpc("set_task_occurrence_assignee", {
      new_assignee_user_id: scenario.outsider.userId,
      occurrence_id: occurrenceId,
    }),
  );
  await expectRpcError(
    scenario.outsider.client.rpc("set_task_occurrence_assignee", {
      new_assignee_user_id: scenario.outsider.userId,
      occurrence_id: occurrenceId,
    }),
  );
  await expectRpcError(
    scenario.outsider.client.rpc("postpone_task_occurrence", {
      new_due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      occurrence_id: occurrenceId,
    }),
  );
  await expectRpcError(
    scenario.owner.client.rpc("complete_maintenance_task", {
      idempotency_key: crypto.randomUUID(),
      occurrence_id: occurrenceId,
      performed_by_user_id: scenario.outsider.userId,
    }),
  );
  await expectRpcError(
    scenario.outsider.client.rpc("complete_maintenance_task", {
      idempotency_key: crypto.randomUUID(),
      occurrence_id: occurrenceId,
      performed_by_user_id: scenario.outsider.userId,
    }),
  );
  await expectRpcError(
    scenario.outsider.client.rpc("create_one_time_task", {
      item_id: fixture.itemId,
      scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      task_title: `越境Todo-${scenario.suffix}`,
    }),
  );
}

async function verifyHouseholdIsolation(scenario: Scenario, fixture: SharedFixture): Promise<void> {
  const urlResponse = await scenario.outsider.page.goto(`/managed-items/${fixture.itemId}`);
  expect(urlResponse?.status()).toBe(404);
  await expect(scenario.outsider.page.getByText(fixture.itemName)).toHaveCount(0);
  const hiddenRules = await scenario.outsider.client
    .from("task_rules")
    .select("id")
    .in("id", [fixture.oneTimeRuleId, fixture.calendarRuleId]);
  expect(hiddenRules.error).toBeNull();
  expect(hiddenRules.data).toEqual([]);
  const occurrenceId = await nextOccurrenceId(scenario, fixture);
  await verifyMutationIsolation(scenario, fixture, occurrenceId);
  const invitation = await scenario.owner.client.rpc("issue_household_invitation", {
    invited_email: `yamoru-e2e-unused-${scenario.suffix}@example.test`,
  });
  expect(invitation.error).toBeNull();
  const invitationId = invitation.data?.[0]?.invitation_id;
  if (invitationId === undefined) throw new Error("分離確認用の招待IDを取得できませんでした。");
  await expectRpcError(
    scenario.outsider.client.rpc("cancel_household_invitation", {
      invitation_id: invitationId,
    }),
  );
}

async function closeScenario(scenario: Scenario | undefined): Promise<void> {
  if (scenario === undefined) return;
  await Promise.all(
    [scenario.owner, scenario.invitee, scenario.outsider].map(async (session) => {
      await session.client.auth.signOut();
      await session.context.close();
    }),
  );
}

test("招待した二アカウントはTodoと履歴を共有し、別家庭はURL・ID・RPCから遮断される", async ({
  browser,
}) => {
  let scenario: Scenario | undefined;
  try {
    scenario = await setupScenario(browser);
    const fixture = await createSharedFixture(scenario);
    await completeOneTimeAndRefresh(scenario, fixture);
    await changeAssignmentAndPostpone(scenario, fixture);
    await completeConcurrently(scenario, fixture);
    await verifyHouseholdIsolation(scenario, fixture);
  } finally {
    await closeScenario(scenario);
  }
});
