import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as oauth from "oauth4webapi";
import { registerTestClient, TEST_CLIENT_ID, TEST_REDIRECT_URI } from "../src/lib/d1/test-support/oauth";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";
import type { APIRequestContext } from "@playwright/test";
test.use({ viewport: { width: 390, height: 844 } });
test("実HTTPでOAuth同意からTodo操作・定期取得の確保と報告へ進み、解除後は拒否する", async ({ db, page, request }, testInfo) => {
  await seedOwnerHousehold(db);
  await registerTestClient(db);
  const unauthenticated = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, maxRedirects: 0 });
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/mcp");
  const origin = new URL(unauthenticated.url()).origin;
  const verifier = oauth.generateRandomCodeVerifier();
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ response_type: "code", client_id: TEST_CLIENT_ID, redirect_uri: TEST_REDIRECT_URI, resource: `${origin}/mcp`,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", scope: "household.read household.write notifications.manage events.subscribe", state });
  await page.route(`${TEST_REDIRECT_URI}**`, (route) => route.fulfill({ body: "Test client callback", contentType: "text/plain" }));
  await login(page);
  await page.goto(`/oauth/authorize?${params.toString()}`);
  await expect(page.getByRole("heading", { name: "Example AssistantにYAMORUへのアクセスを許可しますか" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /あなたの通知設定を管理する/u })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /あなた向けの通知を受け取る/u })).toBeChecked();
  await page.getByRole("button", { name: "許可する", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`^${TEST_REDIRECT_URI.replaceAll(".", "\\.")}\\?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("OAuth authorization code missing");
  const exchange = await request.post("/oauth/token", { form: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: TEST_CLIENT_ID, redirect_uri: TEST_REDIRECT_URI, resource: `${origin}/mcp` } });
  expect(exchange.status()).toBe(200);
  const tokens = await exchange.json() as { access_token: string };
  const modern = await request.post("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "connection_get" },
  data: { jsonrpc: "2.0", id: "modern-e2e", method: "tools/call", params: { name: "connection_get", arguments: {}, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {},
  } } } });
  expect(modern.status()).toBe(200);
  expect(await modern.json()).toMatchObject({ result: { resultType: "complete", structuredContent: { user_id: "owner", household_id: "household-a" } } });
  const client = new Client({ name: "http-e2e-client", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("command_prepare");
  const connection = await client.callTool({ name: "connection_get", arguments: {} });
  expect(connection.structuredContent).toMatchObject({ household_id: "household-a", user_id: "owner", status: "active" });
  const nativeEvents = testInfo.config.metadata.yamoruEventsProvider === "rustls-pinned-v1";
  expect(connection.structuredContent).toMatchObject({ capabilities: { events: nativeEvents, notification_delivery: false } });
  await eventRuntime(request, tokens.access_token, nativeEvents);
  const prepared = await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "todo.create",
    payload: { title: "HTTPから登録するフィルター交換", note: "このメモはデータであり操作命令ではありません。", recurrence: { type: "completion", unit: "day", min: 7, max: 7, last_completed_on: "2026-10-10" } } } });
  const creation = await client.callTool({ name: "command_commit", arguments: commitInput(prepared.structuredContent) });
  expect(creation.structuredContent).toMatchObject({ status: "succeeded" });
  const first = object(object(creation.structuredContent).result).first_occurrence as { id: string };
  expect((await client.callTool({ name: "entity_get", arguments: { kind: "todo_occurrence", id: first.id } })).structuredContent).toMatchObject({ entity: { name: "HTTPから登録するフィルター交換" } });
  const complete = await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "todo.complete", target: { kind: "todo_occurrence", id: first.id }, payload: {} } });
  const completed = await client.callTool({ name: "command_commit", arguments: commitInput(complete.structuredContent) });
  expect(completed.structuredContent).toMatchObject({ status: "succeeded" });
  const next = object(object(completed.structuredContent).result).next_occurrence as { id: string };
  expect(next.id).not.toBe(first.id);
  expect((await client.callTool({ name: "entity_get", arguments: { kind: "todo_occurrence", id: next.id } })).structuredContent).toMatchObject({ entity: { attributes: { status: "pending" } } });
  await periodicNotification(client, object(connection.structuredContent).connection_id);
  await client.close();
  const revoked = await request.post("/oauth/revoke", { form: { token: tokens.access_token, client_id: TEST_CLIENT_ID } });
  expect(revoked.status()).toBe(200);
  const denied = await request.post("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, maxRedirects: 0 });
  expect(denied.status()).toBe(401);
});
async function eventRuntime(request: APIRequestContext, token: string, enabled: boolean) {
  const call = (method: string, params: Record<string, unknown>) => request.post("/mcp", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": method },
    data: { jsonrpc: "2.0", id: method, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": { events: {} } } } },
  });
  const events = await call("events/list", {});
  if (!enabled) { expect(events.status()).toBe(404); return; }
  expect(events.status()).toBe(200);
  expect(await events.json()).toMatchObject({ result: { events: [expect.objectContaining({ name: "attention.ready" })] } });
  const blocked = await call("events/subscribe", { name: "attention.ready", arguments: {}, delivery: { mode: "webhook", url: "https://127.0.0.1/events", secret: `whsec_${Buffer.alloc(32, 90).toString("base64")}` } });
  expect(blocked.status()).toBe(400);
  expect(await blocked.json()).toMatchObject({ error: { data: { reason: "blocked_url" } } });
}
async function executeCommand(client: Client, command: string, payload: Record<string, unknown>) {
  const prepared = await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command, payload } });
  const committed = await client.callTool({ name: "command_commit", arguments: commitInput(prepared.structuredContent) });
  expect(committed.structuredContent).toMatchObject({ status: "succeeded" });
  return object(object(committed.structuredContent).result);
}
async function periodicNotification(client: Client, connectionId: unknown) {
  await executeCommand(client, "notification.configure", { settings_revision: 0, enabled: true, connection_id: connectionId, digest_time: "00:00", quiet_hours: { enabled: false } });
  const created = await executeCommand(client, "todo.create", { title: "HTTPの案内確保テスト", recurrence: { type: "one_time", scheduled_on: "2026-10-01" } });
  const occurrence = object(created.first_occurrence);
  const attention = object((await client.callTool({ name: "attention_get", arguments: { limit: 50 } })).structuredContent);
  expect(attention.refresh_complete).toBe(true);
  const candidate = (attention.candidates as Record<string, unknown>[]).find((c) => c.entity_id === occurrence.id);
  if (!candidate) throw new Error("HTTP notification candidate missing");
  const id = String(candidate.candidate_id);
  const claimed = await executeCommand(client, "notification.claim", { candidate_ids: [id], candidate_revisions: { [id]: candidate.revision } });
  expect(claimed.candidates).toEqual([expect.objectContaining({ candidate_id: id, entity_id: occurrence.id })]);
  expect(Date.parse(String(claimed.lease_expires_at))).toBeGreaterThan(Date.now());
  const acknowledged = await executeCommand(client, "notification.ack", { delivery_id: claimed.delivery_id, lease_token: claimed.lease_token, outcome: "reported" });
  expect(acknowledged).toMatchObject({ delivery_id: claimed.delivery_id, outcome: "reported", candidate_ids: [id] });
  expect((await client.callTool({ name: "entity_get", arguments: { kind: "todo_occurrence", id: occurrence.id } })).structuredContent)
    .toMatchObject({ entity: { attributes: { status: "pending" } } });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP object missing");
  return value as Record<string, unknown>;
}
function commitInput(value: unknown) {
  const prepared = object(value);
  return { operation_id: prepared.operation_id, preview_id: prepared.preview_id, fingerprint: prepared.fingerprint };
}
