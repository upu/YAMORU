import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect } from "@playwright/test";
import { seedManagedItem } from "./fixtures";
import { consent, TEST_CLIENT_ID, TEST_REDIRECT_URI } from "../../src/lib/d1/test-support/oauth";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { APIRequestContext } from "@playwright/test";

type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP object missing");
  return value as RecordValue;
}
export function commitArguments(value: unknown) {
  const p = record(value); return { operation_id: p.operation_id, preview_id: p.preview_id, fingerprint: p.fingerprint };
}
export async function checkMcpBoundaries(client: Client, db: D1Database) {
  // 第二家庭はfixtureで用意し、操作そのものはHTTPのMCP経由で試す。
  await db.batch([
    db.prepare("INSERT INTO users(id,email) VALUES('http-family-b','http-b@example.test')"),
    db.prepare("INSERT INTO households(id,name) VALUES('http-household-b','架空の家庭B')"),
    db.prepare("INSERT INTO household_members(household_id,user_id) VALUES('http-household-b','http-family-b')"),
  ]);
  const id = await seedManagedItem(db, "他家庭の架空器具", "http-family-b");
  const foreign = await client.callTool({ name: "entity_get", arguments: { kind: "managed_item", id } });
  expect(foreign).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } });
  expect(JSON.stringify(foreign)).not.toContain("他家庭の架空器具");
  const denied = await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "managed_item.update",
    target: { kind: "managed_item", id }, payload: { changes: { name: "越境してはならない名前" } } } });
  expect(denied).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } });
  expect(await db.prepare("SELECT name FROM managed_items WHERE id=?").bind(id).first()).toEqual({ name: "他家庭の架空器具" });
}
export async function connectSecondMember(db: D1Database, request: APIRequestContext, origin: string) {
  await db.batch([
    db.prepare("INSERT INTO users(id,email) VALUES('http-family-a2','http-a2@example.test')"),
    db.prepare("INSERT INTO household_members(household_id,user_id) VALUES('household-a','http-family-a2')"),
  ]);
  const auth = await consent(db, { config: { issuer: origin, resource: `${origin}/mcp`, allowedClientIds: [TEST_CLIENT_ID] },
    userId: "http-family-a2", householdId: "household-a" });
  const code = auth.redirectUrl.searchParams.get("code");
  if (!code) throw new Error("Fictional family authorization code missing");
  const exchanged = await request.post("/oauth/token", { form: { grant_type: "authorization_code", code,
    code_verifier: auth.verifier, client_id: TEST_CLIENT_ID, redirect_uri: TEST_REDIRECT_URI, resource: `${origin}/mcp` } });
  expect(exchanged.status()).toBe(200);
  const tokens = await exchanged.json() as { access_token: string };
  const second = new McpClient({ name: "second-fictional-member", version: "1" });
  await second.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  return second;
}
export async function checkMcpCompletionRace(client: Client, second: Client) {
  const created = await client.callTool({ name: "command_prepare", arguments: { operation_id: crypto.randomUUID(), command: "todo.create",
    payload: { title: "HTTPで競合を照合する架空Todo", recurrence: { type: "one_time", scheduled_on: "2026-10-01" } } } });
  const saved = await client.callTool({ name: "command_commit", arguments: commitArguments(created.structuredContent) });
  const id = record(record(saved.structuredContent).result).first_occurrence;
  const target = { kind: "todo_occurrence", id: record(id).id };
  const actors = [client, second];
  const previews = await Promise.all(actors.map((actor) => actor.callTool({ name: "command_prepare", arguments: {
    operation_id: crypto.randomUUID(), command: "todo.complete", target, payload: {},
  } })));
  const outcomes = await Promise.all(previews.map((p, i) => actors[i].callTool({ name: "command_commit", arguments: commitArguments(p.structuredContent) })));
  const success = outcomes.findIndex((o) => record(o.structuredContent).status === "succeeded");
  expect(success).toBeGreaterThanOrEqual(0);
  expect(outcomes.filter((o) => record(o.structuredContent).status === "succeeded")).toHaveLength(1);
  const loser = record(record(outcomes[1 - success].structuredContent).error);
  expect(["stale_preview", "already_resolved"]).toContain(loser.code);
  const preview = record(previews[success].structuredContent);
  const winner = actors[success];
  const replay = await winner.callTool({ name: "command_commit", arguments: commitArguments(preview) });
  expect(replay.structuredContent).toMatchObject({ status: "succeeded", replayed: true, result: record(outcomes[success].structuredContent).result });
  expect((await winner.callTool({ name: "operation_get", arguments: { operation_id: preview.operation_id } })).structuredContent)
    .toMatchObject({ status: "succeeded", result: record(outcomes[success].structuredContent).result });
  const history = record((await client.callTool({ name: "history_list", arguments: target })).structuredContent);
  expect((history.records as RecordValue[]).filter((r) => r.kind === "completed")).toHaveLength(1);
}
