import ipaddr from "ipaddr.js";
import { isPublicWebhookAddress, normalizeWebhookUrl, WebhookEndpointError, type PinnedWebhookRequest } from "../webhook-transport";

const PRIVATE_HEADERS = ["authorization", "cookie", "proxy-authorization", "proxy-connection", "expect", "transfer-encoding", "trailer", "te", "upgrade"];
const encoder = new TextEncoder();
function hostAuthority(host: string) { return ipaddr.isValid(host) && ipaddr.parse(host).kind() === "ipv6" ? `[${host}]` : host; }
function destination(request: PinnedWebhookRequest) {
  if (!isPublicWebhookAddress(request.address)) throw new WebhookEndpointError("blocked_address");
  const version = ipaddr.process(request.address).kind() === "ipv4" ? 4 : 6;
  if (version !== request.family) throw new WebhookEndpointError("blocked_address");
  const url = new URL(normalizeWebhookUrl(`https://${hostAuthority(request.expectedServerHostname)}${request.path}`));
  if (!request.path.startsWith("/") || `${url.pathname}${url.search}` !== request.path) throw new WebhookEndpointError("blocked_url");
  return url;
}

export function serializePinnedPost(request: PinnedWebhookRequest) {
  const url = destination(request);
  const body = encoder.encode(request.body);
  if (body.length > 262_144) throw new WebhookEndpointError("payload_too_large");
  let headers: Headers;
  try { headers = new Headers(request.headers); }
  catch { throw new WebhookEndpointError("blocked_url"); }
  for (const name of PRIVATE_HEADERS) headers.delete(name);
  headers.set("host", url.host);
  headers.set("content-length", String(body.length));
  headers.set("connection", "close");
  headers.set("accept-encoding", "identity");
  const lines = [...headers].map(([name, value]) => {
    if (/[^\t\x20-\x7e]/u.test(value)) throw new WebhookEndpointError("blocked_url");
    return `${name}: ${value}\r\n`;
  });
  const head = encoder.encode(`POST ${request.path} HTTP/1.1\r\n${lines.join("")}\r\n`);
  if (head.length > 16_384) throw new WebhookEndpointError("payload_too_large");
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head); bytes.set(body, head.length);
  return bytes;
}
