// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPublicDnsResolver } from "../src/features/integration/notifications/http/dns-resolver";

type Record = { name: string; type: number; data: string };
function requestedUrl(input: Parameters<typeof fetch>[0]) { return input instanceof Request ? new URL(input.url) : new URL(input); }
function answer(type: number, records: Record[] = [], extras: { Status?: number; TC?: boolean; question?: string } = {}) {
  return Response.json({ Status: extras.Status ?? 0, TC: extras.TC ?? false, Question: [{ name: extras.question ?? "receiver.example.com.", type }], Answer: records }, { headers: { "content-type": "application/dns-json" } });
}
function dnsFetch(a: Record[], aaaa: Record[] = []) {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = requestedUrl(input);
    const type = url.searchParams.get("type") === "A" ? 1 : 28;
    return Promise.resolve(answer(type, type === 1 ? a : aaaa));
  });
}
const signal = () => new AbortController().signal;

describe("public DNS-over-HTTPS resolver", () => {
  it("records a fixed DNS failure without the hostname or raw resolver error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-hostname-and-token"));
      await expect(createPublicDnsResolver(fetcher)("private.example.com", signal())).rejects.toMatchObject({ reason: "unreachable", requestStarted: false });
      expect(warn.mock.calls).toEqual([[{ event: "mcp_event_transport_failure", phase: "dns", category: "unclassified", request_started: false }]]);
    } finally { warn.mockRestore(); }
  });

  it("checks A and AAAA each time through only the fixed HTTPS resolver", async () => {
    const fetcher = dnsFetch([{ name: "receiver.example.com.", type: 1, data: "8.8.8.8" }], [{ name: "receiver.example.com.", type: 28, data: "2001:4860:4860::8888" }]);
    const resolve = createPublicDnsResolver(fetcher);
    expect(await resolve("receiver.example.com", signal())).toEqual(["8.8.8.8", "2001:4860:4860::8888"]);
    await resolve("receiver.example.com", signal());
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [input, options] of fetcher.mock.calls) {
      const url = requestedUrl(input);
      expect(url.origin).toBe("https://cloudflare-dns.com");
      expect(url.pathname).toBe("/dns-query");
      expect(url.searchParams.get("name")).toBe("receiver.example.com");
      expect(options).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", headers: { accept: "application/dns-json" } });
    }
  });

  it("follows only the returned alias chain and binds terminal addresses to that chain", async () => {
    const fetcher = dnsFetch([{ name: "Receiver.Example.Com.", type: 5, data: "alias.example.net." }, { name: "alias.example.net.", type: 1, data: "8.8.8.8" }]);
    expect(await createPublicDnsResolver(fetcher)("receiver.example.com", signal())).toEqual(["8.8.8.8"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["127.0.0.1", "169.254.169.254", "192.168.1.2"])("rejects a private %s even when a public address is also returned", async (privateAddress) => {
    const fetcher = dnsFetch([{ name: "receiver.example.com", type: 1, data: "8.8.8.8" }, { name: "receiver.example.com", type: 1, data: privateAddress }]);
    await expect(createPublicDnsResolver(fetcher)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "blocked_address", requestStarted: false });
  });

  it("does not ignore a private AAAA result behind an otherwise public A result", async () => {
    const fetcher = dnsFetch([{ name: "receiver.example.com", type: 1, data: "8.8.8.8" }], [{ name: "receiver.example.com", type: 28, data: "::1" }]);
    await expect(createPublicDnsResolver(fetcher)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "blocked_address" });
  });

  it.each([
    [{ name: "other.example.com", type: 1, data: "8.8.8.8" }],
    [{ name: "receiver.example.com", type: 5, data: "alias.example.com" }, { name: "alias.example.com", type: 5, data: "receiver.example.com" }],
    [{ name: "receiver.example.com", type: 5, data: "a.example.com" }, { name: "receiver.example.com", type: 5, data: "b.example.com" }],
    [{ name: "receiver.example.com", type: 1, data: "not-an-address" }],
  ].map((records) => ({ records })))("rejects unrelated, cyclic, ambiguous, or invalid answers", async ({ records }) => {
    await expect(createPublicDnsResolver(dnsFetch(records))("receiver.example.com", signal())).rejects.toMatchObject({ reason: "unreachable" });
  });

  it.each([{ TC: true }, { Status: 2 }, { question: "other.example.com" }])("rejects truncated, failed, or mismatched questions", async (extras) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => Promise.resolve(answer(requestedUrl(input).searchParams.get("type") === "A" ? 1 : 28, [], extras)));
    await expect(createPublicDnsResolver(fetcher)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("does not follow resolver redirects or consume an unlimited JSON response", async () => {
    const redirected = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://other.example.com" } }));
    await expect(createPublicDnsResolver(redirected)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "unreachable" });
    const huge = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("x".repeat(16_385), { headers: { "content-type": "application/dns-json" } })));
    await expect(createPublicDnsResolver(huge)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("bounds the returned address set and does not turn NXDOMAIN into a public address", async () => {
    const many = Array.from({ length: 17 }, (_, n) => ({ name: "receiver.example.com", type: 1, data: `8.8.8.${String(n + 1)}` }));
    await expect(createPublicDnsResolver(dnsFetch(many))("receiver.example.com", signal())).rejects.toMatchObject({ reason: "blocked_address" });
    const absent = vi.fn<typeof fetch>().mockImplementation((input) => Promise.resolve(answer(requestedUrl(input).searchParams.get("type") === "A" ? 1 : 28, [], { Status: 3 })));
    await expect(createPublicDnsResolver(absent)("receiver.example.com", signal())).rejects.toMatchObject({ reason: "blocked_address" });
  });

  it("aborts a hanging body without waiting for its cancel promise", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/dns-json" } })));
    const running = createPublicDnsResolver(fetcher)("receiver.example.com", controller.signal);
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "timeout", requestStarted: false });
    expect(cancel).toHaveBeenCalled();
  });

  it("discards late fetch responses even after the resolver has returned a timeout", async () => {
    const controller = new AbortController();
    const pending: ((response: Response) => void)[] = [];
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { pending.push(resolve); }));
    const running = createPublicDnsResolver(fetcher)("receiver.example.com", controller.signal);
    await vi.waitFor(() => { expect(pending).toHaveLength(2); });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "timeout" });
    for (const resolve of pending) resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => { expect(cancel).toHaveBeenCalledTimes(2); });
  });
});
