import ipaddr from "ipaddr.js";
import { discardBody } from "../oauth/limited-body";
export class WebhookEndpointError extends Error {
  constructor(readonly reason: "blocked_url" | "blocked_address" | "redirect_not_allowed" | "payload_too_large" | "timeout" | "unreachable", readonly requestStarted = false) { super(reason); }
}
export function isPublicWebhookAddress(address: string) {
  try { return !address.includes("%") && ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
}
function unbracket(host: string) { return host.startsWith("[") ? host.slice(1, -1) : host; }
function validHostname(host: string) {
  return host.length <= 253 && host.includes(".") && host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    && !["localhost", "local", "internal", "invalid", "test"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
export function normalizeWebhookUrl(value: string) {
  try {
    if (value.length > 2048 || value.trim() !== value || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Invalid URL");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) throw new Error("Invalid destination");
    const host = unbracket(url.hostname.toLowerCase().replace(/\.$/u, ""));
    if (ipaddr.isValid(host)) {
      if (!isPublicWebhookAddress(host)) throw new Error("Non-public address");
    } else {
      if (!validHostname(host)) throw new Error("Invalid hostname");
      url.hostname = host;
    }
    if (url.href.length > 2048) throw new Error("URL too long");
    return url.href;
  } catch { throw new WebhookEndpointError("blocked_url"); }
}
type ConnectionProgress = "connecting" | "request_started";
export type PinnedWebhookRequest = { address: string; family: 4 | 6; expectedServerHostname: string; port: 443; path: string; body: string; headers: Record<string, string>; signal: AbortSignal; readResponseBody?: boolean; reportProgress?: (stage: ConnectionProgress) => void };
// connectorは一つの検証済みIPへ接続し、元のhostのSNIと証明書検証を行う。
// 通常のfetchや、IPを再解決する実装を渡さない。実環境での検証は別途必要。
type Dependencies = { resolve: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>; connect: (request: PinnedWebhookRequest) => Promise<Response> };
type PostInput = { body: string; headers: Record<string, string>; signal?: AbortSignal; readResponseBody?: boolean };
async function withinSignal<T>(run: () => Promise<T>, signal: AbortSignal, started: boolean | (() => boolean)) {
  if (signal.aborted) throw new WebhookEndpointError("timeout");
  let remove = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    const abort = () => { reject(new WebhookEndpointError("timeout", typeof started === "boolean" ? started : started())); };
    signal.addEventListener("abort", abort, { once: true });
    remove = () => { signal.removeEventListener("abort", abort); };
  });
  try { return await Promise.race([run(), interrupted]); }
  finally { remove(); }
}
async function validatedAddress(deps: Dependencies, host: string, signal: AbortSignal) {
  let addresses: readonly string[];
  try { addresses = ipaddr.isValid(host) ? [host] : await withinSignal(() => deps.resolve(host, signal), signal, false); }
  catch (error) { throw error instanceof WebhookEndpointError ? error : new WebhookEndpointError("unreachable"); }
  if (!addresses.length || addresses.length > 16 || addresses.some((address) => !isPublicWebhookAddress(address))) throw new WebhookEndpointError("blocked_address");
  const address = ipaddr.process(addresses[0]);
  return { address: address.toString(), family: address.kind() === "ipv4" ? 4 as const : 6 as const };
}
export function createPinnedWebhookTransport(deps: Dependencies) {
  return {
    async post(value: string, input: PostInput) {
      if (new TextEncoder().encode(input.body).byteLength > 262_144) throw new WebhookEndpointError("payload_too_large");
      const url = new URL(normalizeWebhookUrl(value));
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
      const host = unbracket(url.hostname);
      const address = await validatedAddress(deps, host, signal);
      const headers = new Headers(input.headers);
      headers.set("host", url.host);
      let phase: ConnectionProgress | "unknown" = "unknown";
      const reportProgress = (stage: ConnectionProgress) => { if (phase !== "request_started") phase = stage; };
      let response: Response;
      try {
        response = await withinSignal(() => deps.connect({ ...address, expectedServerHostname: host, port: 443, path: `${url.pathname}${url.search}`,
          body: input.body, headers: Object.fromEntries(headers.entries()), signal, readResponseBody: input.readResponseBody ?? true, reportProgress }), signal, () => phase !== "connecting");
      } catch (error) { throw error instanceof WebhookEndpointError ? error : new WebhookEndpointError("unreachable", true); }
      if (response.status >= 300 && response.status < 400) {
        discardBody(response.body);
        throw new WebhookEndpointError("redirect_not_allowed", true);
      }
      return response;
    },
  };
}
export type PinnedWebhookTransport = ReturnType<typeof createPinnedWebhookTransport>;
