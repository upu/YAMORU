import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { handleMcpRequest } from "../../features/integration/mcp/http";
import { createHouseholdAMaintenanceTask, householdAMember, resetHouseholdFixtures } from "./test-support/households";
import { saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { applyAllMigrations } from "./test-support/migrations";
import { connect, registerTestClient, testOAuthConfig } from "./test-support/oauth";
import { revokeConnection } from "./oauth-connections";
import { verifyAccessToken } from "../../features/integration/oauth/bearer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import { COMMAND_NAMES } from "../../features/integration/commands/contract";
const db = env.DB;
let token: string;
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  token = (await connect(db, { householdId: "household-a", userId: "user-a" })).access_token;
});
async function rpc(method: string, params: Record<string, unknown>, accessToken = token, now?: () => Date, origin?: string) {
  return handleMcpRequest(new Request(testOAuthConfig.resource, { method: "POST", headers: {
    authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...(origin ? { origin } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
  { db, config: testOAuthConfig, cursorSecret: "fictional-mcp-cursor-secret-at-least-32-characters", now, allowedOrigins: origin ? [origin] : undefined });
}
type ToolResult = { isError?: boolean; structuredContent: Record<string, unknown> };
async function tool(name: string, args: Record<string, unknown>, accessToken = token): Promise<ToolResult> {
  const response = await rpc("tools/call", { name, arguments: args }, accessToken);
  expect(response.status).toBe(200);
  return (await response.json() as { result: ToolResult }).result;
}
async function prepare(command: string, payload: Record<string, unknown>, target?: Record<string, unknown>) {
  const result = await tool("command_prepare", { command, operation_id: crypto.randomUUID(), payload, ...(target ? { target } : {}) });
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}
function commitInput(prepared: Record<string, unknown>) { return { operation_id: prepared.operation_id, preview_id: prepared.preview_id, fingerprint: prepared.fingerprint }; }
it("OAuthで認証してMCP discoveryと家庭の読み取りを行い、秘密を返さない", async () => {
  const response = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ result: { protocolVersion: "2025-11-25", serverInfo: { name: "YAMORU" }, capabilities: { tools: {} } } });
  const listed = await (await rpc("tools/list", {})).json() as { result: { tools: { name: string }[] } };
  expect(listed.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["connection_get", "entity_search", "entity_get", "command_prepare", "command_commit", "operation_get"]));
  const metadata = listed.result.tools.find((t) => t.name === "command_prepare") as { inputSchema: { anyOf?: { properties: { command: { const: string } } }[]; oneOf?: { properties: { command: { const: string } } }[] }; annotations: { readOnlyHint: boolean } };
  expect((metadata.inputSchema.oneOf ?? metadata.inputSchema.anyOf)?.map((s) => s.properties.command.const).sort()).toEqual([...COMMAND_NAMES].sort());
  expect(metadata.annotations.readOnlyHint).toBe(false);
  expect(listed.result.tools.find((t) => t.name === "connection_get")).toMatchObject({ securitySchemes: [{ type: "oauth2", scopes: ["household.read"] }] });
  expect(listed.result.tools.find((t) => t.name === "notification_settings_get")).toMatchObject({ securitySchemes: [{ type: "oauth2", scopes: ["household.read", "notifications.manage"] }] });
  const connection = await tool("connection_get", {});
  expect(connection.structuredContent).toMatchObject({ household_id: "household-a", user_id: "user-a", status: "active", request_id: expect.any(String), as_of: expect.any(String), connection_management_url: `${testOAuthConfig.issuer}/settings/integrations`, capabilities: { events: false } });
  expect(JSON.stringify(connection)).not.toContain(token);
  const foreign = await tool("entity_get", { kind: "managed_item", id: "item-b" });
  expect(foreign).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } });
});
it("公式SDKクライアントで再接続し、commit後の通信切断を保存済み結果で回復する", async () => {
  let dropCommit = true;
  const client = new Client({ name: "official-sdk-fixture", version: "1" }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const transport = new StreamableHTTPClientTransport(new URL(testOAuthConfig.resource), { requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = request.method === "POST" ? await request.clone().json() as { method: string; params?: { name?: string } } : null;
      const response = await handleMcpRequest(request, { db, config: testOAuthConfig, cursorSecret: "fictional-mcp-cursor-secret-at-least-32-characters" });
      if (dropCommit && body?.method === "tools/call" && body.params?.name === "command_commit") {
        dropCommit = false;
        throw new TypeError("simulated network disconnect after commit");
      }
      return response;
    } });
  await client.connect(transport);
  expect((await client.listTools()).tools.map((t) => t.name)).toContain("command_prepare");
  const prepared = (await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "todo.create", payload: { title: "通信切断を照合する用事", recurrence: { type: "manual" } } } })).structuredContent;
  if (!prepared) throw new Error("prepared result missing");
  await expect(client.callTool({ name: "command_commit", arguments: commitInput(prepared) })).rejects.toThrow("simulated network disconnect");
  expect(await client.callTool({ name: "operation_get", arguments: { operation_id: prepared.operation_id } })).toMatchObject({ structuredContent: { status: "succeeded" } });
  expect((await db.prepare("SELECT * FROM task_rules WHERE title='通信切断を照合する用事'").all()).results).toHaveLength(1);
  await client.close();
  const reconnected = new Client({ name: "reconnected-fixture", version: "1" }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  await reconnected.connect(new StreamableHTTPClientTransport(new URL(testOAuthConfig.resource), { requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => handleMcpRequest(new Request(input, init), { db, config: testOAuthConfig, cursorSecret: "fictional-mcp-cursor-secret-at-least-32-characters" }) }));
  expect(await reconnected.callTool({ name: "operation_get", arguments: { operation_id: prepared.operation_id } })).toMatchObject({ structuredContent: { status: "succeeded" } });
  await reconnected.close();
});
it("Toolで登録→取得→完了→次回確認を通し、再送と応答喪失の照合で二重実行しない", async () => {
  const prepared = await prepare("todo.create", { title: "MCPのフィルター交換", recurrence: { type: "completion", unit: "day", min: 7, max: 7, last_completed_on: "2026-10-10" } });
  const created = await tool("command_commit", commitInput(prepared));
  expect(created).toMatchObject({ structuredContent: { status: "succeeded" } });
  const result = created.structuredContent.result as Record<string, unknown>;
  const occurrenceId = (result.first_occurrence as Record<string, unknown>).id;
  const detail = await tool("entity_get", { kind: "todo_occurrence", id: occurrenceId });
  expect(detail.structuredContent).toMatchObject({ entity: { name: "MCPのフィルター交換" } });
  const completion = await prepare("todo.complete", {}, { kind: "todo_occurrence", id: occurrenceId });
  const first = await tool("command_commit", commitInput(completion));
  const second = await tool("command_commit", commitInput(completion));
  expect(second).toMatchObject({ structuredContent: { ...first.structuredContent, replayed: true } });
  expect(await tool("operation_get", { operation_id: completion.operation_id })).toMatchObject({ structuredContent: { status: "succeeded" } });
  const completed = first.structuredContent.result as Record<string, unknown>;
  const next = completed.next_occurrence as Record<string, unknown>;
  expect(next.id).not.toBe(occurrenceId);
  expect(await tool("entity_get", { kind: "todo_occurrence", id: next.id })).toMatchObject({ structuredContent: { entity: { attributes: { status: "pending" } } } });
});
it("mainに加わった3つの編集commandもMCP schemaから共通層へ届く", async () => {
  const created = await tool("command_commit", commitInput(await prepare("todo.create", { title: "MCPで編集する用事", recurrence: { type: "one_time", scheduled_on: "2099-01-01" } })));
  const result = created.structuredContent.result as Record<string, unknown>;
  const target = { kind: "todo_occurrence", id: (result.first_occurrence as Record<string, unknown>).id };
  const postponed = await tool("command_commit", commitInput(await prepare("todo.reschedule", { new_due_on: "2099-01-02" }, target)));
  expect(postponed).toMatchObject({ structuredContent: { status: "succeeded", result: { due_on: "2099-01-02" } } });
  const updated = await tool("command_commit", commitInput(await prepare("todo.update", { edit_scope: "one_time_combined", rule_changes: { title: "MCPで編集した用事" }, occurrence_changes: { must_complete_by: "2099-01-03" } }, target)));
  expect(updated).toMatchObject({ structuredContent: { status: "succeeded" } });
  expect(await tool("entity_get", target)).toMatchObject({ structuredContent: { entity: { name: "MCPで編集した用事" } } });
  const createdItem = await tool("command_commit", commitInput(await prepare("managed_item.create", { name: "MCPで編集する器具", kind: "asset" })));
  const itemId = (createdItem.structuredContent.result as Record<string, unknown>).managed_item_id;
  const editedItem = await tool("command_commit", commitInput(await prepare("managed_item.update", { changes: { name: "MCPで編集した器具", note: null } }, { kind: "managed_item", id: itemId })));
  expect(editedItem).toMatchObject({ structuredContent: { status: "succeeded" } });
  expect(await tool("entity_get", { kind: "managed_item", id: itemId })).toMatchObject({ structuredContent: { entity: { name: "MCPで編集した器具" } } });
});
it("権限不足を説明し、失効した接続では再実行しない", async () => {
  const readOnly = (await connect(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read" })).access_token;
  const insufficient = await tool("command_prepare", { command: "todo.create", operation_id: crypto.randomUUID(), payload: {} }, readOnly);
  expect(insufficient)
    .toMatchObject({ isError: true, structuredContent: { error: { code: "insufficient_scope" } } });
  expect(JSON.stringify(insufficient)).toContain("mcp/www_authenticate");
  expect(JSON.stringify(insufficient)).toContain("household.write");
  const notification = await tool("notification_settings_get", {}, readOnly);
  expect(notification).toMatchObject({ isError: true, structuredContent: { error: { code: "insufficient_scope", recovery: "reconnect" } } });
  expect(JSON.stringify(notification)).toContain("notifications.manage");
  expect(JSON.stringify(notification)).not.toContain("household.write");
  const auth = await verifyAccessToken({ db, config: testOAuthConfig }, token, []);
  if (!auth.ok) throw new Error("fixture authentication failed");
  await revokeConnection(db, auth.principal.connectionId, "user_revoked", new Date().toISOString());
  expect((await rpc("tools/list", {})).status).toBe(401);
});
it("在庫の観測・補充・訂正も公開schemaから共通commandへ到達する", async () => {
  await db.prepare("INSERT INTO consumables(id,household_id,name) VALUES('stock','household-a','MCPの洗剤')").run();
  const target = { kind: "consumable", id: "stock" };
  const observed = await prepare("stock.observe", { observed_at: "now", stock_status: "out" }, target);
  expect(await tool("command_commit", commitInput(observed))).toMatchObject({ structuredContent: { status: "succeeded", result: { kind: "observation", current_stock_status: "out" } } });
  const refill = await tool("command_commit", commitInput(await prepare("stock.refill", { refilled_at: "now" }, target)));
  const record = refill.structuredContent.result as Record<string, unknown>;
  const correction = await prepare("stock.correct", { record_id: record.record_id, record_revision: 0, void: true, current_observation: { stock_status: "low" } }, target);
  expect(await tool("command_commit", commitInput(correction))).toMatchObject({ structuredContent: { status: "succeeded", result: { record_voided: true, current_stock_status: "low" } } });
  const history = await tool("history_list", { kind: "consumable", id: "stock" });
  expect(history.structuredContent.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "stock_observed" }), expect.objectContaining({ kind: "stock_voided" })]));
});
it("通知の候補・本人設定・配信履歴を公開し、設定commandも共通層へ渡す", async () => {
  token = (await connect(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read notifications.manage" })).access_token;
  expect(await tool("attention_get", {})).toMatchObject({ structuredContent: { schema_version: 1, refresh_complete: true } });
  const settings = await tool("notification_settings_get", {});
  expect(settings.isError).not.toBe(true);
  expect(settings.structuredContent).toMatchObject({ settings: { enabled: false }, revision: 0 });
  expect(await tool("delivery_list", {})).toMatchObject({ structuredContent: { items: [], next_cursor: null } });
  const preview = await prepare("notification.configure", { settings_revision: settings.structuredContent.revision, muted: true });
  expect(await tool("command_commit", commitInput(preview))).toMatchObject({ structuredContent: { status: "succeeded", result: { settings: { muted: true }, shared_schedule_changed: false } } });
});
it("定期取得のclaim/ackをMCPで実行し、不足権限はevents.subscribeを案内する", async () => {
  token = (await connect(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read events.subscribe" })).access_token;
  const auth = await verifyAccessToken({ db, config: testOAuthConfig }, token, []); if (!auth.ok) throw new Error("Missing auth");
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: auth.principal.connectionId, quietEnabled: false }, 0, new Date());
  const task = await createHouseholdAMaintenanceTask(db);
  const attention = await tool("attention_get", {});
  const candidates = attention.structuredContent.candidates as { candidate_id: string; entity_id: string; revision: string }[];
  const candidate = candidates.find((c) => c.entity_id === task.occurrenceId); if (!candidate) throw new Error("Missing candidate");
  const payload = { candidate_ids: [candidate.candidate_id], candidate_revisions: { [candidate.candidate_id]: candidate.revision } };
  const committed = await tool("command_commit", commitInput(await prepare("notification.claim", payload)));
  expect(committed).toMatchObject({ structuredContent: { status: "succeeded" } });
  const c = committed.structuredContent.result as Record<string, unknown>;
  const ack = { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" };
  expect(await tool("command_commit", commitInput(await prepare("notification.ack", ack)))).toMatchObject({ structuredContent: { status: "succeeded", result: { outcome: "reported" } } });
  const manage = (await connect(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read notifications.manage" })).access_token;
  for (const [command, input] of [["notification.claim", payload], ["notification.ack", ack]]) {
    const denied = await tool("command_prepare", { command, operation_id: crypto.randomUUID(), payload: input }, manage);
    expect(denied).toMatchObject({ isError: true, structuredContent: { error: { code: "insufficient_scope" } } });
    expect(JSON.stringify(denied)).toContain("events.subscribe"); expect(JSON.stringify(denied)).not.toContain("notifications.manage");
  }
});
it("不足項目は共通エラーで返し、同名候補を勝手に一つへ絞らない", async () => {
  const missing = await tool("command_prepare", { command: "todo.create", operation_id: crypto.randomUUID(), payload: {} });
  expect(missing).toMatchObject({ isError: true, structuredContent: { error: { code: "missing_required", recovery: "ask_user" } } });
  await db.prepare("INSERT INTO managed_items(id,household_id,name,kind) VALUES('same-1','household-a','同名フィルター','appliance'),('same-2','household-a','同名フィルター','appliance')").run();
  const search = await tool("entity_search", { query: "同名フィルター", kinds: ["managed_item"] });
  expect(search.isError).not.toBe(true);
  expect(search.structuredContent.candidates).toHaveLength(2);
  expect(search.structuredContent.search_complete).toBe(true);
});
it("巨大・不正なJSONとbatchを拒否し、本文や秘密をエラーへ反射しない", async () => {
  for (const [body, status] of [["x".repeat(65_537), 413], ['{"fake_sensitive":"secret-marker"', 400], ['[{"jsonrpc":"2.0","method":"tools/list","id":1}]', 400]] as const) {
    const response = await handleMcpRequest(new Request(testOAuthConfig.resource, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body }),
      { db, config: testOAuthConfig, cursorSecret: "fictional-mcp-cursor-secret-at-least-32-characters" });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret-marker");
  }
});
it("prepare上限をHTTP 429とRetry-Afterで返し、照合用の読み取り枠は残す", async () => {
  const now = new Date();
  const window = Math.floor(now.getTime() / 60_000) * 60_000;
  await db.prepare("INSERT INTO integration_mcp_rate_windows VALUES('user-a','prepare',?,20)").bind(window).run();
  const origin = "https://inspector.example.test";
  const response = await rpc("tools/call", { name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "todo.create", payload: { title: "must not be created", recurrence: { type: "manual" } } } }, token, () => now, origin);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("access-control-expose-headers")?.toLowerCase().split(",").map((name) => name.trim())).toContain("retry-after");
  expect(await response.json()).toMatchObject({ error: { data: { code: "rate_limited", retryable: true } } });
  expect(await db.prepare("SELECT count(*) AS count FROM integration_operations").first()).toEqual({ count: 0 });
  expect((await tool("connection_get", {})).isError).not.toBe(true);
});
