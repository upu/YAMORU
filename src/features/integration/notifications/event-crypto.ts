import type { IntegrationPrincipal } from "../principal";
import { canonicalJson } from "../commands/contract";
import { z } from "zod";
type Owner = Pick<IntegrationPrincipal, "householdId" | "userId" | "connectionId" | "clientId">;
export type WebhookDestination = { url: string; secret: string; previous?: { secret: string; expiresAt: string } };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const destinationSchema = z.strictObject({ url: z.string(), secret: z.string(), previous: z.strictObject({ secret: z.string(), expiresAt: z.iso.datetime() }).optional() });
export class WebhookCryptoError extends Error {
  constructor(readonly code: "invalid_secret" | "invalid_key" | "decryption_failed") { super(code); }
}
function base64(bytes: Uint8Array<ArrayBuffer>) { return btoa(String.fromCharCode(...bytes)); }
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  if (btoa(decoded).replace(/=+$/u, "") !== value.replace(/=+$/u, "")) throw new Error("Invalid base64");
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export function decodeWebhookSecret(secret: string): Uint8Array<ArrayBuffer> {
  try {
    if (!secret.startsWith("whsec_") || !/^[A-Za-z0-9+/]+={0,2}$/u.test(secret.slice(6))) throw new Error("Invalid secret");
    const bytes = decodeBase64(secret.slice(6));
    if (bytes.byteLength < 24 || bytes.byteLength > 64) throw new Error("Invalid key length");
    return bytes;
  } catch { throw new WebhookCryptoError("invalid_secret"); }
}
async function destinationKey(master: string) {
  if (master.length < 32) throw new WebhookCryptoError("invalid_key");
  const source = await crypto.subtle.importKey("raw", encoder.encode(master), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("yamoru.mcp.events.v1"), info: encoder.encode("webhook destination encryption") },
    source, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function binding(owner: Owner, subscriptionId: string) {
  return encoder.encode(canonicalJson({ householdId: owner.householdId, userId: owner.userId, connectionId: owner.connectionId, clientId: owner.clientId,
    subscriptionId, purpose: "yamoru.mcp.events.destination.v1" }));
}
export async function encryptWebhookDestination(master: string, owner: Owner, subscriptionId: string, destination: WebhookDestination) {
  decodeWebhookSecret(destination.secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128, additionalData: binding(owner, subscriptionId) }, await destinationKey(master), encoder.encode(JSON.stringify(destination)));
  return `v1.${base64(iv)}.${base64(new Uint8Array(sealed))}`;
}
export async function decryptWebhookDestination(master: string, owner: Owner, subscriptionId: string, ciphertext: string): Promise<WebhookDestination> {
  try {
    if (ciphertext.length > 8192) throw new Error("Invalid envelope");
    const parts = ciphertext.split(".");
    const [version, nonce, data] = parts;
    if (parts.length !== 3 || version !== "v1" || !nonce || !data) throw new Error("Invalid envelope");
    const iv = decodeBase64(nonce);
    if (iv.byteLength !== 12) throw new Error("Invalid nonce");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128, additionalData: binding(owner, subscriptionId) }, await destinationKey(master), decodeBase64(data));
    const value = destinationSchema.parse(JSON.parse(decoder.decode(plain)));
    decodeWebhookSecret(value.secret);
    if (value.previous) decodeWebhookSecret(value.previous.secret);
    return value;
  } catch { throw new WebhookCryptoError("decryption_failed"); }
}
export async function standardWebhookHeaders(secret: string, subscriptionId: string, eventId: string, body: string, now: Date, previous?: WebhookDestination["previous"]) {
  if (![subscriptionId, eventId].every((value) => /^[A-Za-z0-9._:-]{1,200}$/u.test(value))) throw new Error("Invalid webhook identity");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const secrets = previous && Date.parse(previous.expiresAt) > now.getTime() ? [secret, previous.secret] : [secret];
  const signatures = await Promise.all(secrets.map(async (value) => {
    const key = await crypto.subtle.importKey("raw", decodeWebhookSecret(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return `v1,${base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${eventId}.${timestamp}.${body}`))))}`;
  }));
  return { "Content-Type": "application/json", "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": signatures.join(" "), "X-MCP-Subscription-Id": subscriptionId };
}
export async function sameChallenge(expected: string, actual: string) {
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(actual));
}
