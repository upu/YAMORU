import ipaddr from "ipaddr.js";
import { z } from "zod";
import { isPublicWebhookAddress, WebhookEndpointError } from "../webhook-transport";

const record = z.object({ name: z.string().max(254), type: z.number().int(), data: z.string().max(16_384) });
const response = z.object({ Status: z.number().int(), TC: z.literal(false), Question: z.array(z.object({ name: z.string().max(254), type: z.number().int() })).length(1), Answer: z.array(record).max(48).optional() });
type DnsRecord = z.infer<typeof record>;
function invalidDns(): never { throw new WebhookEndpointError("unreachable"); }
function dnsName(value: string) {
  const name = value.toLowerCase().replace(/\.$/u, "");
  if (!name || name.length > 253 || !name.split(".").every((label) => /^[a-z0-9_-]{1,63}$/u.test(label))) invalidDns();
  return name;
}

function terminalName(records: readonly DnsRecord[], hostname: string) {
  const aliases = new Map<string, string>();
  for (const entry of records.filter((entry) => entry.type === 5)) {
    const from = dnsName(entry.name), to = dnsName(entry.data);
    if (aliases.has(from) && aliases.get(from) !== to) invalidDns();
    aliases.set(from, to);
  }
  let current = hostname;
  const seen = new Set([current]);
  for (let depth = 0; depth < 8; depth++) {
    const next = aliases.get(current);
    if (!next) return current;
    if (seen.has(next)) invalidDns();
    seen.add(next); current = next;
  }
  if (aliases.has(current)) invalidDns();
  return current;
}

function publicRecord(entry: DnsRecord, type: number, terminal: string) {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try { address = ipaddr.parse(entry.data); } catch { return invalidDns(); }
  if (!isPublicWebhookAddress(entry.data)) throw new WebhookEndpointError("blocked_address");
  if (entry.type !== type || dnsName(entry.name) !== terminal || (type === 1) !== (address.kind() === "ipv4")) invalidDns();
  return address.toString();
}

export function parseDnsAnswer(text: string, hostname: string, type: number) {
  const parsed = response.safeParse(JSON.parse(text) as unknown);
  if (!parsed.success) invalidDns();
  const value = parsed.data;
  if (value.Question[0].type !== type || dnsName(value.Question[0].name) !== hostname || ![0, 3].includes(value.Status)) invalidDns();
  const records = value.Answer ?? [];
  const terminal = terminalName(records, hostname);
  const addresses = records.filter((entry) => entry.type === 1 || entry.type === 28);
  if (value.Status === 3 && addresses.length) invalidDns();
  return addresses.map((entry) => publicRecord(entry, type, terminal));
}
