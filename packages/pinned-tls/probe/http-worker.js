import { createLazyWorkerNotificationTransport } from "../../../src/features/integration/notifications/worker-transport-loader.ts";
import { WebhookEndpointError } from "../../../src/features/integration/notifications/webhook-transport.ts";
import { standardWebhookHeaders } from "../../../src/features/integration/notifications/event-crypto.ts";

const fixtures = {
  echo: { url: "https://httpbin.org/post", body: '{"message":"fictional あ"}' },
  status: { url: "https://httpbin.org/status/202", head: true },
  large_body: { url: "https://httpbin.org/post", body: JSON.stringify({ message: "x".repeat(5000) }) },
  large_head: { url: "https://httpbin.org/post", body: JSON.stringify({ message: "x".repeat(5000) }), head: true },
  redirect: { url: "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%2F" },
  wrong: { url: "https://wrong.host.badssl.com/" },
  expired: { url: "https://expired.badssl.com/" },
  selfsigned: { url: "https://self-signed.badssl.com/" },
  private: { url: "https://127.0.0.1/" },
  delay: { url: "https://httpbin.org/delay/15" },
};

const worker = {
  async fetch(request) {
    const testCase = new URL(request.url).searchParams.get("case") ?? "echo";
    if (!Object.hasOwn(fixtures, testCase)) return new Response("unknown case", { status: 400 });
    const fixture = fixtures[testCase];
    const started = Date.now();
    try {
      const body = fixture.body ?? "{}";
      const fixtureKey = `whsec_${btoa(String.fromCharCode(...new Uint8Array(32).fill(90)))}`;
      const headers = await standardWebhookHeaders(fixtureKey, "fictional-sub", "fictional-event", body, new Date());
      const response = await createLazyWorkerNotificationTransport().post(fixture.url, { body, readResponseBody: !fixture.head,
        headers: { ...headers, authorization: "fictional-do-not-forward", cookie: "fictional-do-not-forward" } });
      let echo;
      if (testCase === "echo") {
        const value = await response.json();
        echo = { messageMatches: value.json?.message === "fictional あ", webhookIdMatches: value.headers?.["Webhook-Id"] === "fictional-event", signatureMatches: value.headers?.["Webhook-Signature"] === headers["webhook-signature"],
          privateHeadersAbsent: !value.headers?.Authorization && !value.headers?.Cookie };
      }
      return Response.json({ testCase, ok: true, status: response.status, headOnly: response.body === null, echo, elapsedMs: Date.now() - started });
    } catch (error) {
      return Response.json({ testCase, ok: false, reason: error instanceof WebhookEndpointError ? error.reason : "unexpected", requestStarted: error instanceof WebhookEndpointError ? error.requestStarted : null, elapsedMs: Date.now() - started });
    }
  },
};
export default worker;
