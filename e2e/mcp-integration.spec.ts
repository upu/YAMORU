import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as oauth from "oauth4webapi";
import { registerTestClient, TEST_CLIENT_ID, TEST_REDIRECT_URI } from "../src/lib/d1/test-support/oauth";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";
test.use({ viewport: { width: 390, height: 844 } });
test("実HTTPでOAuthの同意からMCP登録・取得・完了・次回確認へ進み、解除後は拒否する", async ({ db, page, request }) => {
  await seedOwnerHousehold(db);
  await registerTestClient(db);
  const unauthenticated = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, maxRedirects: 0 });
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/mcp");
  const origin = new URL(unauthenticated.url()).origin;
  const verifier = oauth.generateRandomCodeVerifier();
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ response_type: "code", client_id: TEST_CLIENT_ID, redirect_uri: TEST_REDIRECT_URI, resource: `${origin}/mcp`,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", scope: "household.read household.write", state });
  await page.route(`${TEST_REDIRECT_URI}**`, (route) => route.fulfill({ body: "Test client callback", contentType: "text/plain" }));
  await login(page);
  await page.goto(`/oauth/authorize?${params.toString()}`);
  await expect(page.getByRole("heading", { name: "Example AssistantにYAMORUへのアクセスを許可しますか" })).toBeVisible();
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
  await client.close();
  const revoked = await request.post("/oauth/revoke", { form: { token: tokens.access_token, client_id: TEST_CLIENT_ID } });
  expect(revoked.status()).toBe(200);
  const denied = await request.post("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, maxRedirects: 0 });
  expect(denied.status()).toBe(401);
});
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP object missing");
  return value as Record<string, unknown>;
}
function commitInput(value: unknown) {
  const prepared = object(value);
  return { operation_id: prepared.operation_id, preview_id: prepared.preview_id, fingerprint: prepared.fingerprint };
}
