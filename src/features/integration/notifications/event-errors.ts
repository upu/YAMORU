export class EventSubscriptionError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "insufficient_scope" | "connection_unavailable" | "subscription_limit" | "callback_unavailable" | "key_unavailable" | "read_conflict",
    readonly reason?: "challenge_failed" | "timeout" | "unreachable" | "blocked_url" | "blocked_address" | "redirect_not_allowed" | "payload_too_large" | "response_too_large" | "http_error" | "transport_unverified" | "subscription_schema" | "filter_schema" | "filter_conflict" | "signing_secret") { super(code); }
}
