import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  recordConsumableRefillInD1Mock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  recordConsumableRefillInD1Mock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumables", () => ({
  recordConsumableRefill: recordConsumableRefillInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { recordConsumableRefill } from "../src/app/consumables/refill-actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

afterEach(() => {
  vi.useRealTimers();
});

function form(id = "consumable-1"): FormData {
  const data = new FormData();
  data.set("id", id);
  return data;
}

describe("Consumableの補充記録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // UTCでは9月1日だが、Asia/Tokyoでは9月2日。
    vi.setSystemTime(new Date("2026-09-01T15:30:00.000Z"));
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    recordConsumableRefillInD1Mock.mockResolvedValue(undefined);
  });

  it("操作日の東京暦日で補充を記録し、関連画面を更新する", async () => {
    await expect(recordConsumableRefill(INITIAL_STATE, form())).resolves.toEqual({
      message: "補充を記録し、在庫を「ある」に更新しました。",
      status: "success",
    });

    expect(recordConsumableRefillInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "consumable-1",
      "2026-09-02",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables/consumable-1");
  });

  it("空のIDはD1へ送らない", async () => {
    await expect(recordConsumableRefill(INITIAL_STATE, form("  "))).resolves.toEqual({
      message: "消耗品を確認できませんでした。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });
});
