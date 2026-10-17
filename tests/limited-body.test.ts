import { expect, it } from "vitest";
import { readTextWithLimit } from "../src/features/integration/oauth/limited-body";
it("上限超過時は転送先のclose完了を待たずに本文を拒否する", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2)); }, cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  expect(await readTextWithLimit(body, 1)).toBeNull();
  expect(cancelled).toBe(true);
});
