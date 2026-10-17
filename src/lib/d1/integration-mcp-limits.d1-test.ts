import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetHouseholdFixtures } from "./test-support/households";
import { connect, registerTestClient, testOAuthConfig } from "./test-support/oauth";
import { verifyAccessToken } from "../../features/integration/oauth/bearer";
import { acquireMcpBudget, releaseMcpLease, mcpCommitGuard } from "./integration-mcp-limits";
import type { IntegrationPrincipal } from "../../features/integration/principal";
const db = env.DB;
let principal: IntegrationPrincipal;
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  const tokens = await connect(db, { householdId: "household-a", userId: "user-a" });
  const verified = await verifyAccessToken({ db, config: testOAuthConfig }, tokens.access_token, ["household.read"]);
  if (!verified.ok) throw new Error("fixture authentication failed");
  principal = verified.principal;
});
it("並列のprepareを20件で止め、別接続でも利用者の枠を共有する", async () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const results = await Promise.all(Array.from({ length: 25 }, () => acquireMcpBudget(db, principal, "prepare", now)));
  expect(results.filter((r) => r.ok)).toHaveLength(20);
  expect(results.filter((r) => !r.ok)).toHaveLength(5);
  const otherToken = await connect(db, { householdId: "household-a", userId: "user-a" });
  const other = await verifyAccessToken({ db, config: testOAuthConfig }, otherToken.access_token, ["household.read"]);
  if (!other.ok) throw new Error("second fixture connection missing");
  expect(other.principal.connectionId).not.toBe(principal.connectionId);
  expect(await acquireMcpBudget(db, other.principal, "prepare", now)).toMatchObject({ ok: false, retryAfter: 60 });
  expect(await acquireMcpBudget(db, principal, "read", now)).toMatchObject({ ok: true });
  expect(await acquireMcpBudget(db, principal, "prepare", new Date(now.getTime() + 60_000))).toMatchObject({ ok: true });
});
it("同時commitを2枠に限定し、失敗時の解放と期限切れを回復する", async () => {
  const now = new Date();
  const results = await Promise.all(Array.from({ length: 3 }, () => acquireMcpBudget(db, principal, "commit", now)));
  expect(results.filter((r) => !r.ok)).toHaveLength(1);
  const [first, second] = results.filter((r) => r.ok);
  if (!first.ok || !first.lease || !second.ok || !second.lease) throw new Error("lease missing");
  expect(await acquireMcpBudget(db, principal, "commit", now)).toMatchObject({ ok: false });
  await releaseMcpLease(db, first.lease);
  const replacement = await acquireMcpBudget(db, principal, "commit", now);
  if (!replacement.ok || !replacement.lease) throw new Error("replacement missing");
  await releaseMcpLease(db, first.lease);
  expect(await acquireMcpBudget(db, principal, "commit", now)).toMatchObject({ ok: false });
  await db.prepare("UPDATE integration_mcp_commit_leases SET expires_at=0 WHERE connection_id=?").bind(principal.connectionId).run();
  const recovered = await acquireMcpBudget(db, principal, "commit", now);
  expect(recovered).toMatchObject({ ok: true });
  await expect(db.batch([
    db.prepare("UPDATE managed_items SET name='must roll back' WHERE id='item-a'"),
    mcpCommitGuard(db, first.lease),
  ])).rejects.toThrow();
  expect(await db.prepare("SELECT name FROM managed_items WHERE id='item-a'").first()).toEqual({ name: "Item A" });
});
it("失効・別人の接続で枠を確保せず、親削除で運用状態も消える", async () => {
  expect(await acquireMcpBudget(db, { ...principal, userId: "user-b" }, "commit", new Date())).toMatchObject({ ok: false });
  expect(await acquireMcpBudget(db, principal, "commit", new Date())).toMatchObject({ ok: true });
  await db.prepare("DELETE FROM oauth_connections WHERE id=?").bind(principal.connectionId).run();
  expect(await db.prepare("SELECT count(*) AS count FROM integration_mcp_commit_leases").first()).toEqual({ count: 0 });
  await db.prepare("DELETE FROM users WHERE id=?").bind(principal.userId).run();
  expect(await db.prepare("SELECT count(*) AS count FROM integration_mcp_rate_windows WHERE user_id=?").bind(principal.userId).first()).toEqual({ count: 0 });
});
