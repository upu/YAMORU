import type { IntegrationPrincipal } from "../principal";
import type { EventRecipientAttempt } from "../../../lib/d1/notification-event-dispatch";
import type { SendResult } from "../../../lib/d1/notification-outbox";
import { decryptWebhookDestination, standardWebhookHeaders } from "./event-crypto";
import { WebhookEndpointError, type PinnedWebhookTransport } from "./webhook-transport";
import { discardBody } from "../oauth/limited-body";
type Dependencies = { principal: IntegrationPrincipal; secret: string; providerId: string; transport: PinnedWebhookTransport; now?: () => Date; signal?: AbortSignal };
function transportFailure(error: unknown): SendResult {
  if (!(error instanceof WebhookEndpointError)) return { kind: "unknown", reason: "transport_error" };
  if (["blocked_url", "blocked_address", "redirect_not_allowed", "payload_too_large"].includes(error.reason)) return { kind: "failed", reason: error.reason };
  return { kind: error.requestStarted ? "unknown" : "retry", reason: error.reason };
}
function receivedResponse(response: Response): SendResult {
  discardBody(response.body);
  if (response.ok) return { kind: "accepted" };
  if (response.status < 200) return { kind: "unknown", reason: "response_unavailable" };
  const transient = response.status >= 500 || [408, 425, 429].includes(response.status);
  return { kind: transient ? "retry" : "failed", reason: `http_${String(response.status)}` };
}
// 呼出元は各宛先のbeginを直前に確定し、戻り値を同じ試行tokenで保存する。
// ここでは再送しない。通信後の保存失敗を理由に、同じPOSTを繰り返してはいけない。
export async function sendEventRecipient(deps: Dependencies, attempt: EventRecipientAttempt): Promise<SendResult> {
  if (!deps.principal.scopes.includes("household.read") || !deps.principal.scopes.includes("events.subscribe")) return { kind: "failed", reason: "access_unavailable" };
  if (attempt.providerId !== deps.providerId) return { kind: "failed", reason: "provider_unavailable" };
  if (deps.signal?.aborted) return { kind: "retry", reason: "timeout" };
  let prepared: { url: string; headers: Record<string, string> };
  try {
    const destination = await decryptWebhookDestination(deps.secret, deps.principal, attempt.subscriptionId, attempt.encryptedDestination);
    const headers = await standardWebhookHeaders(destination.secret, attempt.subscriptionId, attempt.eventId, attempt.body, (deps.now ?? (() => new Date()))(), destination.previous);
    prepared = { url: destination.url, headers };
  } catch { return { kind: "failed", reason: "key_unavailable" }; }
  if (deps.signal?.aborted) return { kind: "retry", reason: "timeout" };
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  try { return receivedResponse(await deps.transport.post(prepared.url, { body: attempt.body, headers: prepared.headers, signal, readResponseBody: false })); }
  catch (error) { return transportFailure(error); }
}
