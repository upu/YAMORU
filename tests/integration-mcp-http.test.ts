import { expect, it, vi } from "vitest";
import { handleMcpRequest } from "../src/features/integration/mcp/http";
import type { OAuthConfig } from "../src/features/integration/oauth/config";
const config: OAuthConfig = { issuer: "https://yamoru.example.test", resource: "https://yamoru.example.test/mcp", allowedClientIds: ["https://client.example.test/oauth/client.json"] };
function dependencies(enabled = true) {
  const prepareMock = vi.fn();
  return { config: enabled ? config : null, db: { prepare: prepareMock } as unknown as D1Database, prepareMock, cursorSecret: "fictional-mcp-cursor-secret-at-least-32-characters" };
}
it("設定前のMCP入口は無効で、Cookieログインへ誘導しない", async () => {
  const response = await handleMcpRequest(new Request(config.resource, { method: "POST", body: "{}" }), dependencies(false));
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
});
it("未認証はOAuth resource metadataのchallengeを返し、業務のDBを読まない", async () => {
  const deps = dependencies();
  const response = await handleMcpRequest(new Request(config.resource, { method: "POST", body: "{}" }), deps);
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain('/.well-known/oauth-protected-resource/mcp');
  expect(deps.prepareMock).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBeNull();
});
it("未知のOriginからのブラウザー要求を拒否する", async () => {
  const response = await handleMcpRequest(new Request(config.resource, { method: "POST", headers: { origin: "https://untrusted.example.test" }, body: "{}" }), dependencies());
  expect(response.status).toBe(403);
});
it("CookieやqueryのtokenだけではBearer認証を通さない", async () => {
  const deps = dependencies();
  const response = await handleMcpRequest(new Request(`${config.resource}?access_token=fake`, { method: "POST", headers: { cookie: "authjs.session-token=fake" }, body: "{}" }), deps);
  expect(response.status).toBe(401);
  expect(deps.prepareMock).not.toHaveBeenCalled();
});
it("切断済みの要求を成功扱いせず、DB操作を始めない", async () => {
  const controller = new AbortController();
  controller.abort();
  const deps = dependencies();
  const response = await handleMcpRequest(new Request(config.resource, { method: "POST", signal: controller.signal, body: "{}" }), deps);
  expect(response.status).toBe(408);
  expect(await response.text()).toContain("operation_get");
  expect(deps.prepareMock).not.toHaveBeenCalled();
});
