import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetHouseholdFixtures } from "./test-support/households";
import { connect, registerTestClient, testOAuthConfig } from "./test-support/oauth";
import { handleMcpRequest } from "../../features/integration/mcp/http";
const db = env.DB;
const version = "2026-07-28";
const meta = { "io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientCapabilities": {} };
let token: string;
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  token = (await connect(db, { householdId: "household-a", userId: "user-a" })).access_token;
});
async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, accessToken = token) {
  return handleMcpRequest(new Request(testOAuthConfig.resource, { method: "POST", headers: {
    authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": version, "mcp-method": method, ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}), ...headers,
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { _meta: meta, ...params } }) }),
  { db, config: testOAuthConfig, cursorSecret: "fictional-modern-mcp-secret-at-least-32-characters" });
}
async function tool(name: string, args: Record<string, unknown>) {
  const response = await rpc("tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  return (await response.json() as { result: { structuredContent: Record<string, unknown>; resultType: string; isError?: boolean } }).result;
}
it("initializeなしで2026の発見・Tool一覧・本人読み取りを行う", async () => {
  const discovered = await rpc("server/discover");
  expect(discovered.status).toBe(200);
  expect(await discovered.json()).toMatchObject({ result: { resultType: "complete", supportedVersions: [version, "2025-11-25"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "YAMORU" } } } });
  const list = await rpc("tools/list");
  expect(list.status).toBe(200);
  expect(await list.json()).toMatchObject({ result: { resultType: "complete", tools: expect.arrayContaining([expect.objectContaining({ name: "command_prepare" })]) } });
  expect(await tool("connection_get", {})).toMatchObject({ resultType: "complete", structuredContent: { user_id: "user-a", household_id: "household-a" } });
  expect(discovered.headers.get("mcp-session-id")).toBeNull();
});
it("version・method・nameのheaderと本文が異なる要求を実行しない", async () => {
  for (const [method, params, headers] of [
    ["server/discover", {}, { "mcp-protocol-version": "2025-11-25" }],
    ["server/discover", {}, { "mcp-method": "tools/call" }],
    ["tools/call", { name: "connection_get", arguments: {} }, { "mcp-name": "command_commit" }],
    ["tools/call", { name: "connection_get", arguments: {} }, { "mcp-name": "=?base64?not valid!?=" }],
  ] as [string, Record<string, unknown>, Record<string, string>][]) {
    const response = await rpc(method, params, headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });
  }
  const encoded = await rpc("tools/call", { name: "connection_get", arguments: {} }, { "mcp-name": `=?base64?${btoa("connection_get")}?=` });
  expect(encoded.status).toBe(200);
});
it("未知の版には対応版を案内し、clientInfoやcapabilitiesを認可に使わない", async () => {
  const unsupported = "2099-01-01";
  const response = await rpc("server/discover", { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": unsupported } }, { "mcp-protocol-version": unsupported });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: -32022, data: { supported: [version, "2025-11-25"], requested: unsupported } } });
  const forged = await rpc("tools/call", { name: "connection_get", arguments: {}, _meta: { ...meta, "io.modelcontextprotocol/clientInfo": { name: "admin", version: "1", household_id: "household-b" }, "io.modelcontextprotocol/clientCapabilities": { household_id: "household-b" } } });
  expect(await forged.json()).toMatchObject({ result: { structuredContent: { household_id: "household-a", user_id: "user-a" } } });
});
it("2026でも共通prepare/commitと結果照合を通し、再送で二重登録しない", async () => {
  const operationId = crypto.randomUUID();
  const prepared = (await tool("command_prepare", { operation_id: operationId, command: "todo.create", payload: { title: "新しいprotocolから登録", recurrence: { type: "manual" } } })).structuredContent;
  const input = { operation_id: operationId, preview_id: prepared.preview_id, fingerprint: prepared.fingerprint };
  const first = await tool("command_commit", input);
  expect(first).toMatchObject({ resultType: "complete", structuredContent: { status: "succeeded" } });
  const replayed = await tool("command_commit", input);
  expect(replayed).toMatchObject({ resultType: "complete", structuredContent: { replayed: true, recorded_at: first.structuredContent.recorded_at } });
  expect(replayed.structuredContent.result).toEqual(first.structuredContent.result);
  expect(await tool("operation_get", { operation_id: operationId })).toMatchObject({ structuredContent: { status: "succeeded" } });
  expect(await db.prepare("SELECT count(*) AS n FROM task_rules WHERE title='新しいprotocolから登録'").first()).toEqual({ n: 1 });
});
it("権限不足の再認証案内・大きな入力・未知のmethodを区別する", async () => {
  const readOnly = (await connect(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read" })).access_token;
  const denied = await rpc("tools/call", { name: "command_prepare", arguments: { command: "todo.create", operation_id: crypto.randomUUID(), payload: {} } }, {}, readOnly);
  expect(await denied.json()).toMatchObject({ result: { resultType: "complete", isError: true, _meta: { "mcp/www_authenticate": expect.any(Array) } } });
  const tooMany = await rpc("tools/call", { name: "entity_search", arguments: { query: "", kinds: Array.from({ length: 1001 }, () => "todo_rule") } });
  expect(tooMany.status).toBe(400);
  expect(await tooMany.json()).toMatchObject({ error: { code: -32602 } });
  const missing = await rpc("unknown/method");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: -32601 } });
  const noCapabilities = await rpc("server/discover", { _meta: { "io.modelcontextprotocol/protocolVersion": version } });
  expect(noCapabilities.status).toBe(400);
  expect(await noCapabilities.json()).toMatchObject({ error: { code: -32602 } });
  expect((await rpc("server/discover", {}, { accept: "application/json;q=0, text/event-stream" })).status).toBe(406);
  expect((await rpc("server/discover", {}, { "content-type": "text/plain" })).status).toBe(415);
});
