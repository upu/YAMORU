// @ts-expect-error OpenNext generates this JavaScript entry during cf:build without declarations.
import handler from "./.open-next/worker.js";
import { runNotificationScheduler } from "./src/features/integration/notifications/scheduler";
import { parseAllowedClientIds } from "./src/features/integration/oauth/config";

// OpenNextの生成物には型宣言がないため、公開fetch境界だけをここで受ける。
const openNext = handler as { fetch: (request: Request, environment: CloudflareEnv, context: unknown) => Promise<Response> };
const worker = {
  fetch: openNext.fetch,
  async scheduled(_event: unknown, environment: CloudflareEnv) {
    const result = await runNotificationScheduler({ db: environment.DB, allowedClientIds: parseAllowedClientIds(environment.YAMORU_OAUTH_ALLOWED_CLIENT_IDS) });
    console.info(JSON.stringify({ event: "yamoru.notifications.scheduler_completed", ...result }));
    if (result.failed > 0) throw new Error("notification_scheduler_partial_failure");
  },
};
export default worker;
