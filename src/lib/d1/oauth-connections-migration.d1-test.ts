// Issue #436 / YDR-052: 0031は外部接続のテーブルを足すだけのexpand migration。
// 既存の家庭データを変えないこと、旧Workerの書き込みが通ること、制約と
// cascadeをDBが守ることを確かめる。0030は#51(必達日)のmigration。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

const CLIENT = "https://client.example.test/oauth/client.json";
const NOW = "2026-10-17T00:00:00.000Z";
const LATER = "2026-11-17T00:00:00.000Z";

beforeAll(async () => {
  await applyMigrationsThrough(db, "0030_occurrence_hard_deadline");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name, created_at) VALUES ('household-a', 'Household A', '2026-01-02T03:04:05.000Z'), ('household-b', 'Household B', '2026-01-02T03:04:05.000Z')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Legacy A', 'other')"),
  ]);
  await applyMigrations(db, ["0031_oauth_connections"]);
  await db.prepare(
    "INSERT INTO oauth_clients (id, client_name, redirect_uris, metadata_fetched_at) VALUES (?1, 'Example', '[\"https://client.example.test/cb\"]', ?2)",
  ).bind(CLIENT, NOW).run();
});

function insertConnection(id: string, householdId: string, userId: string, overrides: Record<string, string | null> = {}) {
  const values = { expires_at: LATER, revoked_at: null, revoked_reason: null, scopes: "household.read", ...overrides };
  return db.prepare(
    `INSERT INTO oauth_connections (id, household_id, user_id, client_id, client_name, scopes, resource, issuer, user_session_version, created_at, expires_at, revoked_at, revoked_reason)
     VALUES (?1, ?2, ?3, ?4, 'Example', ?5, 'https://y.example.test/mcp', 'https://y.example.test', 0, ?6, ?7, ?8, ?9)`,
  ).bind(id, householdId, userId, CLIENT, values.scopes, NOW, values.expires_at, values.revoked_at, values.revoked_reason);
}

describe("外部接続のmigration(0031_oauth_connections)", () => {
  it("既存の家庭・メンバー・台帳を保ち、旧Workerの書き込みもそのまま通る", async () => {
    await expect(db.prepare("SELECT name, created_at FROM households WHERE id = 'household-a'").first())
      .resolves.toEqual({ created_at: "2026-01-02T03:04:05.000Z", name: "Household A" });
    await expect(db.prepare("SELECT count(*) AS count FROM oauth_connections").first())
      .resolves.toEqual({ count: 0 });
    await db.batch([
      db.prepare("UPDATE managed_items SET name = 'Renamed' WHERE id = 'item-a' AND household_id = 'household-a'"),
      db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-old', 'household-a', 'Old worker', 'other')"),
    ]);
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });

  it("CIMDのclient_idはHTTPSのURLに限り、redirect_urisはJSON配列に限る", async () => {
    await expect(db.prepare(
      "INSERT INTO oauth_clients (id, client_name, redirect_uris, metadata_fetched_at) VALUES ('http://insecure.example.test/c.json', 'x', '[]', ?1)",
    ).bind(NOW).run()).rejects.toThrow();
    await expect(db.prepare(
      "INSERT INTO oauth_clients (id, client_name, redirect_uris, metadata_fetched_at) VALUES ('https://x.example.test/c.json', 'x', '\"not-array\"', ?1)",
    ).bind(NOW).run()).rejects.toThrow();
  });

  it("失効の時刻と理由は対で持ち、未知の理由を拒否する", async () => {
    await expect(insertConnection("conn-invalid-1", "household-a", "user-a", { revoked_at: NOW }).run()).rejects.toThrow();
    await expect(insertConnection("conn-invalid-2", "household-a", "user-a", { revoked_at: NOW, revoked_reason: "unknown" }).run()).rejects.toThrow();
    await expect(insertConnection("conn-revoked", "household-a", "user-a", { revoked_at: NOW, revoked_reason: "user_revoked" }).run()).resolves.toBeDefined();
  });

  it("PKCEはS256だけを保存でき、tokenの種類はaccess/refreshに限る", async () => {
    await expect(db.prepare(
      `INSERT INTO oauth_authorization_codes (code_hash, household_id, user_id, client_id, scopes, redirect_uri, resource, code_challenge, code_challenge_method, user_session_version, created_at, expires_at)
       VALUES ('code-plain', 'household-a', 'user-a', ?1, 'household.read', 'https://client.example.test/cb', 'https://y.example.test/mcp', ?2, 'plain', 0, ?3, ?4)`,
    ).bind(CLIENT, "a".repeat(43), NOW, LATER).run()).rejects.toThrow();
    await insertConnection("conn-kind", "household-a", "user-a").run();
    await expect(db.prepare(
      "INSERT INTO oauth_tokens (token_hash, connection_id, kind, scopes, created_at, expires_at) VALUES ('t-id', 'conn-kind', 'id_token', 'household.read', ?1, ?2)",
    ).bind(NOW, LATER).run()).rejects.toThrow();
  });

  it("家庭や利用者を削除すると、その接続とtokenも残らない", async () => {
    await insertConnection("conn-b", "household-b", "user-b").run();
    await db.prepare(
      "INSERT INTO oauth_tokens (token_hash, connection_id, kind, scopes, created_at, expires_at) VALUES ('t-b', 'conn-b', 'access', 'household.read', ?1, ?2)",
    ).bind(NOW, LATER).run();
    await db.prepare("DELETE FROM households WHERE id = 'household-b'").run();
    await expect(db.prepare("SELECT count(*) AS count FROM oauth_connections WHERE id = 'conn-b'").first())
      .resolves.toEqual({ count: 0 });
    await expect(db.prepare("SELECT count(*) AS count FROM oauth_tokens WHERE token_hash = 't-b'").first())
      .resolves.toEqual({ count: 0 });
  });
});
