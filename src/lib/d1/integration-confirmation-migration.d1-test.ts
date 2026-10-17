import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";

// #437 / YDR-062: 0043は受付記録へ追加確認の列とtriggerを足すだけのexpand
// migration。既存の受付記録と旧Workerの書き込みを確認不要のまま保ち、承認の
// 無い確認必須の操作は成功にできないことを確かめる。
const CLIENT = "https://client.example.test/oauth/client.json";
const NOW = "2026-10-17T00:00:00.000Z";
const LATER = "2026-10-17T00:10:00.000Z";

// 旧Workerと同じ列だけを書くINSERT。
const LEGACY_INSERT = `INSERT INTO integration_operations (
  id, household_id, user_id, client_id, connection_id, operation_id, command, request_hash, fingerprint,
  preview_id, normalized_command, preview, status, business_key, created_at, expires_at, revision_epoch, revision_version
) VALUES (?1, 'ha', 'a', ?2, 'conn', ?3, 'todo.complete', 'h', 'f', ?4, '{}', '{}', 'prepared', ?5, ?6, ?7, 'epoch', 1)`;

function legacyInsert(db: D1Database, id: string, operationId: string) {
  return db.prepare(LEGACY_INSERT).bind(id, CLIENT, operationId, `preview-${id}`, `integration:${id}`, NOW, LATER);
}

describe("追加確認のmigration(0043_integration_command_confirmation)", () => {
  it("既存の受付記録と旧Workerの書き込みを確認不要のまま保ち、承認の無い成功を拒否する", async () => {
    const db = env.DB;
    await applyMigrationsThrough(db, "0042_notification_outbox_sources");
    await db.batch([
      db.prepare("INSERT INTO users(id,email) VALUES ('a','a@example.com')"),
      db.prepare("INSERT INTO households(id,name) VALUES ('ha','A')"),
      db.prepare("INSERT INTO household_members(household_id,user_id) VALUES ('ha','a')"),
      db.prepare("INSERT INTO oauth_clients (id, client_name, redirect_uris, metadata_fetched_at) VALUES (?1, 'Example', '[\"https://client.example.test/cb\"]', ?2)").bind(CLIENT, NOW),
      db.prepare(`INSERT INTO oauth_connections (id, household_id, user_id, client_id, client_name, scopes, resource, issuer, user_session_version, created_at, expires_at)
        VALUES ('conn', 'ha', 'a', ?1, 'Example', 'household.read household.write', 'https://y.example.test/mcp', 'https://y.example.test', 0, ?2, '2026-11-17T00:00:00.000Z')`).bind(CLIENT, NOW),
      legacyInsert(db, "op-old", "00000000-0000-4000-8000-000000000001"),
    ]);
    await applyMigrationsAfter(db, "0042_notification_outbox_sources");

    await expect(db.prepare(
      "SELECT id, created_at, confirmation_state, confirmation_status, subject_key FROM integration_operations WHERE id = 'op-old'",
    ).first()).resolves.toEqual({
      confirmation_state: "not_needed", confirmation_status: null, created_at: NOW, id: "op-old", subject_key: null,
    });
    // 旧Workerの書き込みと成功の記録は、これまでどおり通る。
    await legacyInsert(db, "op-legacy", "00000000-0000-4000-8000-000000000002").run();
    await db.prepare("UPDATE integration_operations SET status = 'succeeded', result = '{}', resolved_at = ?1 WHERE id = 'op-legacy'").bind(NOW).run();

    // 確認必須の操作は、承認されるまで成功にできない。
    await db.prepare(LEGACY_INSERT.replace("revision_version\n)", "revision_version, confirmation_state, confirmation_status\n)")
      .replace("'epoch', 1)", "'epoch', 1, 'required', 'pending')"))
      .bind("op-required", CLIENT, "00000000-0000-4000-8000-000000000003", "preview-op-required", "integration:op-required", NOW, LATER).run();
    const succeed = () => db.prepare("UPDATE integration_operations SET status = 'succeeded', result = '{}', resolved_at = ?1 WHERE id = 'op-required'").bind(NOW).run();
    await expect(succeed()).rejects.toThrow(/confirmation required/u);
    // 確認の状態は確認必須の操作でだけ、確認待ちから一度だけ決められる。
    await expect(db.prepare("UPDATE integration_operations SET confirmation_status = 'approved' WHERE id = 'op-old'").run())
      .rejects.toThrow(/invalid confirmation decision/u);
    await db.prepare("UPDATE integration_operations SET confirmation_status = 'approved', confirmation_decided_at = ?1 WHERE id = 'op-required'").bind(NOW).run();
    await expect(db.prepare("UPDATE integration_operations SET confirmation_status = 'denied' WHERE id = 'op-required'").run())
      .rejects.toThrow(/invalid confirmation decision/u);
    await succeed();
    // 確認不要の操作は確認の状態を持てない。
    await expect(db.prepare(LEGACY_INSERT.replace("revision_version\n)", "revision_version, confirmation_status\n)")
      .replace("'epoch', 1)", "'epoch', 1, 'pending')"))
      .bind("op-bad", CLIENT, "00000000-0000-4000-8000-000000000004", "preview-op-bad", "integration:op-bad", NOW, LATER).run())
      .rejects.toThrow(/confirmation_status requires/u);
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });
});
