import { afterEach, expect, it, vi } from "vitest";
import { retryLocalD1Read } from "../src/lib/d1/read-retry";
afterEach(() => vi.restoreAllMocks());
const bookmarkFailure = () => new Error("D1_ERROR: Failed to get session commit token: internal error; reference = fictional");
it("既知のローカルbookmark失敗だけを読み直し、家庭データやSQLをログへ出さない", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const read = vi.fn().mockRejectedValueOnce(bookmarkFailure()).mockResolvedValue({ name: "架空の台帳" });
  expect(await retryLocalD1Read(read, [0])).toEqual({ name: "架空の台帳" });
  expect(read).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "yamoru.local_d1_read_retry", attempt: 2 }));
});
it.each([new Error("D1_ERROR: no such table"), new Error("D1_ERROR: Failed to parse body as JSON"), new Error("not_found")])("未知の失敗は再試行せず元のエラーを返す: %s", async (failure) => {
  const read = vi.fn().mockRejectedValue(failure);
  await expect(retryLocalD1Read(read, [0])).rejects.toBe(failure);
  expect(read).toHaveBeenCalledTimes(1);
});
it("既知の失敗も有限回で止め、最後のエラーを隠さない", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = bookmarkFailure(); const read = vi.fn().mockRejectedValue(failure);
  await expect(retryLocalD1Read(read, [0, 0])).rejects.toBe(failure);
  expect(read).toHaveBeenCalledTimes(3);
});
