import { z } from "zod";
import type { IntegrationPrincipal } from "../principal";
import { canonicalJson, sha256Hex } from "../commands/contract";
import { normalizeEventFilter, type EventFilter } from "./event-filter";
import { decodeWebhookSecret, decryptWebhookDestination, encryptWebhookDestination, sameChallenge, standardWebhookHeaders, WebhookCryptoError, type WebhookDestination } from "./event-crypto";
import { normalizeWebhookUrl, WebhookEndpointError, type PinnedWebhookTransport } from "./webhook-transport";
import { EventSubscriptionError } from "./event-errors";
import { declaresTooLargeBody, readTextWithLimit } from "../oauth/limited-body";
import { activeEventSubscriptionCount, authorizeEventOwner, eventSubscription, recentWebhookVerification, saveEventSubscription, stopEventSubscription, validateEventTargets, type EventSubscriptionIdentity, type EventSubscriptionRow } from "../../../lib/d1/notification-event-subscriptions";

type Dependencies = { db: D1Database; authorize: () => Promise<IntegrationPrincipal>; secret: string; providerId: string; transport?: PinnedWebhookTransport; now?: () => Date; signal?: AbortSignal; commitGuard?: D1PreparedStatement };
const destination = z.strictObject({ mode: z.literal("webhook"), url: z.string().max(2048) });
const stopSchema = z.strictObject({ name: z.literal("attention.ready"), arguments: z.unknown().optional(), delivery: destination });
const subscribeSchema = stopSchema.extend({ delivery: destination.extend({ secret: z.string().max(128) }), cursor: z.null().optional(), ttlMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional() });
const systemNow = () => new Date();
async function currentOwner(deps: Dependencies) {
  const principal = await deps.authorize();
  const grant = await authorizeEventOwner(deps.db, principal, (deps.now ?? systemNow)());
  return { principal, grant };
}
function sameOwner(a: IntegrationPrincipal, b: IntegrationPrincipal) {
  return a.userId === b.userId && a.householdId === b.householdId && a.connectionId === b.connectionId && a.clientId === b.clientId;
}
async function identity(p: IntegrationPrincipal, url: string, filter: EventFilter): Promise<EventSubscriptionIdentity> {
  const owner = { householdId: p.householdId, userId: p.userId, connectionId: p.connectionId, clientId: p.clientId };
  return { id: `sub_${await sha256Hex(canonicalJson({ v: 1, owner, event: "attention.ready", url, filter }))}`, filter,
    callbackOrigin: new URL(url).origin, callbackHash: await sha256Hex(url) };
}
function available(deps: Dependencies) {
  if (!deps.transport || !deps.providerId || deps.providerId.length > 100) throw new EventSubscriptionError("callback_unavailable", "transport_unverified");
  if (deps.signal?.aborted) throw new EventSubscriptionError("callback_unavailable", "timeout");
  return deps.transport;
}
function normalizedSecret(value: string) {
  try { return `whsec_${btoa(String.fromCharCode(...decodeWebhookSecret(value)))}`; }
  catch { throw new EventSubscriptionError("invalid_input"); }
}
async function verifyResponse(response: Response, challenge: string, signal: AbortSignal) {
  if (!response.ok) { await response.body?.cancel(); throw new EventSubscriptionError("callback_unavailable", "http_error"); }
  if (declaresTooLargeBody(response.headers, 4096)) { await response.body?.cancel(); throw new EventSubscriptionError("callback_unavailable", "response_too_large"); }
  const text = await readTextWithLimit(response.body, 4096, signal);
  if (text === null) throw new EventSubscriptionError("callback_unavailable", "response_too_large");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new EventSubscriptionError("callback_unavailable", "challenge_failed"); }
  const result = z.object({ challenge: z.string() }).safeParse(value);
  if (!result.success || !await sameChallenge(challenge, result.data.challenge)) throw new EventSubscriptionError("callback_unavailable", "challenge_failed");
}
async function verifyCallback(deps: Dependencies, id: string, url: string, secret: string) {
  const transport = available(deps);
  const challenge = crypto.randomUUID();
  const body = JSON.stringify({ type: "verification", challenge });
  const headers = await standardWebhookHeaders(secret, id, `verification_${crypto.randomUUID()}`, body, (deps.now ?? systemNow)());
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  try { await verifyResponse(await transport.post(url, { body, headers, signal }), challenge, signal); }
  catch (error) {
    if (signal.aborted) throw new EventSubscriptionError("callback_unavailable", "timeout");
    if (error instanceof EventSubscriptionError) throw error;
    if (error instanceof WebhookEndpointError) throw new EventSubscriptionError("callback_unavailable", error.reason);
    throw new EventSubscriptionError("callback_unavailable", "unreachable");
  }
  return (deps.now ?? systemNow)().toISOString();
}
async function sealedDestination(deps: Dependencies, principal: IntegrationPrincipal, target: EventSubscriptionIdentity, previous: EventSubscriptionRow | null, url: string, secret: string, now: Date) {
  try {
    const value: WebhookDestination = { url, secret };
    if (previous?.state === "active" && previous.encrypted_destination && previous.expires_at > now.toISOString()) {
      const old = await decryptWebhookDestination(deps.secret, principal, target.id, previous.encrypted_destination);
      if (old.secret !== secret) value.previous = { secret: old.secret, expiresAt: new Date(now.getTime() + 300_000).toISOString() };
      else if (old.previous && old.previous.expiresAt > now.toISOString()) value.previous = old.previous;
    }
    return await encryptWebhookDestination(deps.secret, principal, target.id, value);
  } catch (error) { if (error instanceof WebhookCryptoError) throw new EventSubscriptionError("key_unavailable"); throw error; }
}
export function createEventSubscriptionService(deps: Dependencies) {
  const clock = deps.now ?? systemNow;
  return {
    async subscribe(raw: unknown) {
      const { principal } = await currentOwner(deps);
      available(deps);
      const parsed = subscribeSchema.safeParse(raw);
      if (!parsed.success) throw new EventSubscriptionError("invalid_input");
      const filter = normalizeEventFilter(parsed.data.arguments);
      await validateEventTargets(deps.db, principal, filter);
      const url = normalizeWebhookUrl(parsed.data.delivery.url);
      const secret = normalizedSecret(parsed.data.delivery.secret);
      const target = await identity(principal, url, filter);
      const previous = await eventSubscription(deps.db, principal, target.id);
      if (await activeEventSubscriptionCount(deps.db, principal, target.id, clock()) >= 20) throw new EventSubscriptionError("subscription_limit");
      const keyFingerprint = await sha256Hex(secret);
      const cached = await recentWebhookVerification(deps.db, principal, target.callbackHash, keyFingerprint, deps.providerId, clock());
      const verifiedAt = cached?.verified_at ?? await verifyCallback(deps, target.id, url, secret);
      const current = await currentOwner(deps);
      if (!sameOwner(principal, current.principal)) throw new EventSubscriptionError("connection_unavailable");
      available(deps);
      const now = clock();
      const ttl = Math.max(60_000, Math.min(parsed.data.ttlMs ?? 86_400_000, 86_400_000));
      const expiresAt = new Date(Math.min(now.getTime() + ttl, Date.parse(current.grant.expires_at))).toISOString();
      const encryptedDestination = await sealedDestination(deps, principal, target, previous, url, secret, now);
      await saveEventSubscription(deps.db, principal, { ...target, encryptedDestination, keyFingerprint, providerId: deps.providerId, verifiedAt, expiresAt, expectedRevision: previous?.revision ?? 0 }, now, deps.commitGuard);
      return { id: target.id, refreshBefore: expiresAt, cursor: null, truncated: false };
    },
    async unsubscribe(raw: unknown) {
      const { principal } = await currentOwner(deps);
      const parsed = stopSchema.safeParse(raw);
      if (!parsed.success) throw new EventSubscriptionError("invalid_input");
      const filter = normalizeEventFilter(parsed.data.arguments);
      const url = normalizeWebhookUrl(parsed.data.delivery.url);
      await stopEventSubscription(deps.db, principal, await identity(principal, url, filter), clock(), deps.commitGuard);
      return {};
    },
  };
}
