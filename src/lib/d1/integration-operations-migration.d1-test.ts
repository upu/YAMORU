// Issue #437 / YDR-054: 0033は外部commandの受付記録を足すだけのexpand migration。
// 既存の家庭データと旧Workerの書き込みを変えないこと、受付記録の一意性と
// 状態の整合をDBが守ること、家庭の削除に追従することを確かめる。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

const CLIENT = "https://client.example.test/oauth/client.json";
const NOW = "2026-10-17T00:00:00.000Z";
const LATER = "2026-10-17T00:10:00.000Z";

beforeAll(async () => {
  await applyMigrationsThrough(db, "0031_oauth_connections");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name, created_at) VALUES ('household-a', 'Household A', '2026-01-02T03:04:05.000Z'), ('household-b', 'Household B', '2026-01-02T03:04:05.000Z')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Legacy A', 'other')"),
    db.prepare("INSERT INTO oauth_clients (id, client_name, redirect_uris, metadata_fetched_at) VALUES (?1, 'Example', '[\"https://client.example.test/cb\"]', ?2)").bind(CLIENT, NOW),
    db.prepare(
      `INSERT INTO oauth_connections (id, household_id, user_id, client_id, client_name, scopes, resource, issuer, user_session_version, created_at, expires_at)
       VALUES ('conn-a', 'household-a', 'user-a', ?1, 'Example', 'household.read household.write', 'https://y.example.test/mcp', 'https://y.example.test', 0, ?2, '2026-11-17T00:00:00.000Z'),
              ('conn-b', 'household-b', 'user-b', ?1, 'Example', 'household.read household.write', 'https://y.example.test/mcp', 'https://y.example.test', 0, ?2, '2026-11-17T00:00:00.000Z')`,
    ).bind(CLIENT, NOW),
  ]);
  await applyMigrations(db, ["0033_integration_operations"]);
});

function insertOperation(id: string, overrides: Record<string, string | null> = {}) {
  const values = {
    connection_id: "conn-a",
    household_id: "household-a",
    operation_id: "00000000-0000-4000-8000-000000000001",
    reason_code: null,
    resolved_at: null,
    result: null,
    status: "prepared",
    user_id: "user-a",
    ...overrides,
  };
  return db.prepare(
    `INSERT INTO integration_operations (
      id, household_id, user_id, client_id, connection_id, operation_id, command, request_hash, fingerprint,
      preview_id, normalized_command, preview, status, reason_code, business_key, result, created_at, expires_at, resolved_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'todo.complete', 'h', 'f', ?7, '{}', '{}', ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    id, values.household_id, values.user_id, CLIENT, values.connection_id, values.operation_id,
    `preview-${id}`, values.status, values.reason_code, `integration:${id}`, values.result, NOW, LATER, values.resolved_at,
  );
}

describe("外部commandの受付記録のmigration(0033_integration_operations)", () => {
  it("既存の家庭・台帳を保ち、旧Workerの書き込みもそのまま通る", async () => {
    await expect(db.prepare("SELECT name, created_at FROM households WHERE id = 'household-a'").first())
      .resolves.toEqual({ created_at: "2026-01-02T03:04:05.000Z", name: "Household A" });
    await db.prepare("UPDATE managed_items SET name = 'Renamed' WHERE id = 'item-a' AND household_id = 'household-a'").run();
    await expect(db.prepare("SELECT count(*) AS count FROM integration_operations").first()).resolves.toEqual({ count: 0 });
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });

  it("操作IDは接続ごとに一意で、別の接続なら同じ値を使える", async () => {
    await insertOperation("op-1").run();
    await expect(insertOperation("op-2").run()).rejects.toThrow();
    await expect(insertOperation("op-3", { connection_id: "conn-b", household_id: "household-b", user_id: "user-b" }).run())
      .resolves.toBeDefined();
  });

  it("状態と確定時刻・理由・結果の組み合わせが崩れた行を拒否する", async () => {
    const operationId = (n: number) => `00000000-0000-4000-8000-00000000010${String(n)}`;
    await expect(insertOperation("op-x1", { operation_id: operationId(1), status: "unknown" }).run()).rejects.toThrow();
    await expect(insertOperation("op-x2", { operation_id: operationId(2), resolved_at: NOW, status: "succeeded" }).run()).rejects.toThrow();
    await expect(insertOperation("op-x3", { operation_id: operationId(3), resolved_at: NOW, status: "rejected" }).run()).rejects.toThrow();
    await expect(insertOperation("op-x4", { operation_id: "not-a-uuid" }).run()).rejects.toThrow();
    await expect(insertOperation("op-ok", { operation_id: operationId(5), resolved_at: NOW, result: "{}", status: "succeeded" }).run())
      .resolves.toBeDefined();
  });

  it("家庭を削除すると、その受付記録も残らない", async () => {
    await insertOperation("op-b", { connection_id: "conn-b", household_id: "household-b", operation_id: "00000000-0000-4000-8000-000000000201", user_id: "user-b" }).run();
    await db.prepare("DELETE FROM households WHERE id = 'household-b'").run();
    await expect(db.prepare("SELECT count(*) AS count FROM integration_operations WHERE household_id = 'household-b'").first())
      .resolves.toEqual({ count: 0 });
  });
});
