import { expect, it, vi } from "vitest";
import { createPinnedWebhookTransport, isPublicWebhookAddress, normalizeWebhookUrl } from "../src/features/integration/notifications/webhook-transport";
it("非公開・予約・IPv4埋込アドレスを拒否する", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) expect(isPublicWebhookAddress(address)).toBe(true);
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1"]) expect(isPublicWebhookAddress(address)).toBe(false);
});
it("URLの表記を正規化し、認証情報・内部host・redirect用fragmentを受け付けない", () => {
  expect(normalizeWebhookUrl("https://HOOKS.EXAMPLE.COM:443/events?token=fictional")).toBe("https://hooks.example.com/events?token=fictional");
  for (const url of ["http://hooks.example.com/events", "https://user:pass@hooks.example.com/events", "https://localhost./events", "https://a.local/events", "https://metadata/events", "https://127.1/events", "https://2130706433/events", "https://[::ffff:127.0.0.1]/events", "https://hooks.example.com:444/events", "https://hooks.example.com/events#hidden"]) expect(() => normalizeWebhookUrl(url)).toThrow();
});
it("要求ごとにDNSを検査し、その検査済みIPと元のTLS名だけをconnectorへ渡す", async () => {
  const resolve = vi.fn().mockResolvedValueOnce(["8.8.8.8"]).mockResolvedValueOnce(["127.0.0.1"]);
  const connect = vi.fn().mockResolvedValue(new Response("{}"));
  const transport = createPinnedWebhookTransport({ resolve, connect });
  await transport.post("https://hooks.example.com/events?token=fictional", { body: "{}", headers: { "webhook-id": "event-1", host: "127.0.0.1" } });
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ address: "8.8.8.8", family: 4, expectedServerHostname: "hooks.example.com", path: "/events?token=fictional", port: 443,
    headers: { "webhook-id": "event-1", host: "hooks.example.com" } }));
  await expect(transport.post("https://hooks.example.com/events", { body: "{}", headers: {} })).rejects.toMatchObject({ reason: "blocked_address" });
  expect(connect).toHaveBeenCalledTimes(1);
});
it("privateが混ざる応答とredirectを拒否し、payload上限より前に接続しない", async () => {
  const connect = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  const resolve = vi.fn().mockResolvedValueOnce(["8.8.8.8", "::1"]).mockResolvedValue(["8.8.8.8"]);
  const transport = createPinnedWebhookTransport({ resolve, connect });
  await expect(transport.post("https://hooks.example.com/events", { body: "{}", headers: {} })).rejects.toMatchObject({ reason: "blocked_address" });
  expect(connect).not.toHaveBeenCalled();
  await expect(transport.post("https://hooks.example.com/events", { body: "{}", headers: {} })).rejects.toMatchObject({ reason: "redirect_not_allowed" });
  expect(connect).toHaveBeenCalledTimes(1);
  await expect(transport.post("https://hooks.example.com/events", { body: "x".repeat(262_145), headers: {} })).rejects.toMatchObject({ reason: "payload_too_large" });
  await expect(transport.post("https://hooks.example.com/events", { body: "あ".repeat(87_382), headers: {} })).rejects.toMatchObject({ reason: "payload_too_large" });
  expect(resolve).toHaveBeenCalledTimes(2);
});
it("DNS中の取消は未送信と区別し、接続を始めない", async () => {
  const controller = new AbortController();
  const resolve = vi.fn().mockImplementation(() => { controller.abort(); return Promise.resolve(["8.8.8.8"]); });
  const connect = vi.fn().mockResolvedValue(new Response("{}"));
  const transport = createPinnedWebhookTransport({ resolve, connect });
  await expect(transport.post("https://hooks.example.com/events", { body: "{}", headers: {}, signal: controller.signal })).rejects.toMatchObject({ reason: "timeout", requestStarted: false });
  expect(connect).not.toHaveBeenCalled();
});
