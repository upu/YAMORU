import { afterEach, describe, expect, test, vi } from "vitest";

import { retryD1Busy } from "../e2e/support/d1-busy-retry";

describe("retryD1Busy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("一時的なSQLITE_BUSYだけを待って再試行する", async () => {
    const busyError = new Error("D1_ERROR: NOSENTRY database is locked: SQLITE_BUSY");
    const operation = vi.fn()
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockResolvedValue("完了");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(retryD1Busy("seed-owner", operation, [0, 0])).resolves.toBe("完了");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      "[e2e:d1] seed-owner SQLITE_BUSY; retrying 2/3 after 0ms",
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      "[e2e:d1] seed-owner SQLITE_BUSY; retrying 3/3 after 0ms",
    );
  });

  test("SQLITE_BUSY以外は再試行せず元のエラーを返す", async () => {
    const constraintError = new Error("D1_ERROR: UNIQUE constraint failed");
    const operation = vi.fn().mockRejectedValue(constraintError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(retryD1Busy("seed-owner", operation, [0, 0])).rejects.toBe(constraintError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("再試行上限までSQLITE_BUSYが続けば元のエラーを返す", async () => {
    const busyError = new Error("database is locked");
    const operation = vi.fn().mockRejectedValue(busyError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(retryD1Busy("clear", operation, [0, 0])).rejects.toBe(busyError);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
