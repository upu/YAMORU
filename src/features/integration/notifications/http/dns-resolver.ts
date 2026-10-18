import { declaresTooLargeBody, discardBody, readTextWithLimit } from "../../oauth/limited-body";
import { normalizeWebhookUrl, WebhookEndpointError } from "../webhook-transport";
import { parseDnsAnswer } from "./dns-answer";
import { IoScope } from "./lifecycle";

function queryUrl(hostname: string, type: "A" | "AAAA") {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname); url.searchParams.set("type", type); url.searchParams.set("cd", "false");
  return url;
}

async function fetchAnswer(fetcher: typeof fetch, url: URL, scope: IoScope, signal: AbortSignal) {
  let owned: Response | undefined;
  const pending = fetcher(url, { method: "GET", headers: { accept: "application/dns-json" }, redirect: "manual", cache: "no-store", signal }).then((result) => {
    owned = result;
    if (signal.aborted) { discardBody(result.body); throw new WebhookEndpointError("timeout"); }
    return result;
  });
  try { return await scope.wait(() => pending); }
  catch (error) { if (owned) discardBody(owned.body); throw error; }
}

async function query(fetcher: typeof fetch, hostname: string, type: "A" | "AAAA", scope: IoScope, signal: AbortSignal) {
  const result = await fetchAnswer(fetcher, queryUrl(hostname, type), scope, signal);
  try {
    const mediaType = result.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (result.status !== 200 || result.redirected || !["application/dns-json", "application/json"].includes(mediaType ?? "") || declaresTooLargeBody(result.headers, 16_384)) throw new WebhookEndpointError("unreachable");
    const text = await scope.wait(() => readTextWithLimit(result.body, 16_384, signal));
    if (text === null) throw new WebhookEndpointError("unreachable");
    return parseDnsAnswer(text, hostname, type === "A" ? 1 : 28);
  } finally { discardBody(result.body); }
}

function normalizedHostname(value: string) {
  if (!/^[a-z0-9.-]{1,254}$/iu.test(value)) throw new WebhookEndpointError("blocked_url");
  return new URL(normalizeWebhookUrl(`https://${value}/`)).hostname;
}

export function createPublicDnsResolver(fetcher: typeof fetch = fetch) {
  return async (value: string, callerSignal: AbortSignal): Promise<readonly string[]> => {
    const hostname = normalizedHostname(value);
    const stop = new AbortController();
    const signal = AbortSignal.any([callerSignal, stop.signal, AbortSignal.timeout(10_000)]);
    const scope = new IoScope(signal);
    try {
      scope.check();
      const parts = await Promise.all([query(fetcher, hostname, "A", scope, signal), query(fetcher, hostname, "AAAA", scope, signal)]);
      const addresses = parts.flat();
      if (!addresses.length || addresses.length > 16) throw new WebhookEndpointError("blocked_address");
      return [...new Set(addresses)];
    } catch (error) {
      if (error instanceof WebhookEndpointError) throw error;
      throw new WebhookEndpointError(signal.aborted ? "timeout" : "unreachable");
    } finally { stop.abort(); scope.dispose(); }
  };
}
