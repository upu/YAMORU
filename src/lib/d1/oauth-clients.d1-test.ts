import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOAuthClient } from "../../features/integration/oauth/client-metadata";
import { getOAuthClient } from "./oauth-clients";
import { resetHouseholdFixtures } from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import { TEST_CLIENT_ID, TEST_REDIRECT_URI, testOAuthConfig } from "./test-support/oauth";

// CIMD(Client ID Metadata Document)の取得・検証・D1への写し(#436)。
// 実際のネットワークへは出ず、fetchを差し替えて確かめる。
const db = env.DB;
const config = testOAuthConfig;

const validDocument = {
  client_id: TEST_CLIENT_ID,
  client_name: "Example Assistant",
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: [TEST_REDIRECT_URI],
  response_types: ["code"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
};

function fetchReturning(response: () => Response) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(response()));
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("CIMDの取得", () => {
  it("許可済みのclient_idだけを、リダイレクトを追従せずに取得してD1へ写す", async () => {
    const fetchImpl = fetchReturning(() => Response.json(validDocument));
    const result = await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl });
    expect(result).toMatchObject({ client: { clientName: "Example Assistant", redirectUris: [TEST_REDIRECT_URI] }, ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(await getOAuthClient(db, TEST_CLIENT_ID)).toMatchObject({ id: TEST_CLIENT_ID });
  });

  it("許可されていないclient_idは取得しない", async () => {
    const fetchImpl = fetchReturning(() => Response.json(validDocument));
    const result = await resolveOAuthClient(db, config, "https://attacker.example.test/client.json", { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "client_not_allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("新しい写しがあれば取得せず、古くなったら取り直す", async () => {
    const fetchImpl = fetchReturning(() => Response.json(validDocument));
    const fetchedAt = new Date("2026-10-17T00:00:00.000Z");
    await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl, now: fetchedAt });
    await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl, now: new Date("2026-10-17T12:00:00.000Z") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl, now: new Date("2026-10-18T01:00:00.000Z") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["リダイレクト", () => new Response(null, { headers: { location: "http://127.0.0.1/" }, status: 302 })],
    ["5KBを超える文書", () => Response.json({ ...validDocument, padding: "x".repeat(6000) })],
    ["client_idの不一致", () => Response.json({ ...validDocument, client_id: "https://other.example.test/client.json" })],
    ["httpのredirect_uri", () => Response.json({ ...validDocument, redirect_uris: ["http://client.example.test/callback"] })],
    ["公開クライアントに対応しない", () => Response.json({ ...validDocument, token_endpoint_auth_methods_supported: ["private_key_jwt"] })],
    ["JSONでない", () => new Response("<html></html>")],
  ])("%sは受け付けず、写しも作らない", async (_label, response) => {
    const result = await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl: fetchReturning(response) });
    expect(result.ok).toBe(false);
    expect(await getOAuthClient(db, TEST_CLIENT_ID)).toBeNull();
  });

  it("表示名の制御文字を除き、長さを制限する", async () => {
    const fetchImpl = fetchReturning(() => Response.json({ ...validDocument, client_name: `A\u0000B${"x".repeat(200)}` }));
    const result = await resolveOAuthClient(db, config, TEST_CLIENT_ID, { fetchImpl });
    expect(result.ok && result.client.clientName.startsWith("AB")).toBe(true);
    expect(result.ok && result.client.clientName.length).toBe(100);
  });
});
