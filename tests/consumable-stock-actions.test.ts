import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  revalidatePathMock,
  updateConsumableStockStatusInD1Mock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateConsumableStockStatusInD1Mock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumables", () => ({
  updateConsumableStockStatus: updateConsumableStockStatusInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateConsumableStockStatus } from "../src/app/consumables/stock-actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function form(status: string, id = "consumable-1"): FormData {
  const data = new FormData();
  data.set("id", id);
  data.set("stockStatus", status);
  return data;
}

describe("Consumable在庫状態の変更操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateConsumableStockStatusInD1Mock.mockResolvedValue(undefined);
  });

  it.each(["available", "low", "out"])("%sへ可逆に変更して関連画面を更新する", async (status) => {
    await expect(updateConsumableStockStatus(INITIAL_STATE, form(status))).resolves.toEqual({
      message: "在庫状態を更新しました。",
      status: "success",
    });

    expect(updateConsumableStockStatusInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "consumable-1",
      status,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables/consumable-1");
  });

  it("定義外の状態をD1へ送らない", async () => {
    await expect(updateConsumableStockStatus(INITIAL_STATE, form("unknown"))).resolves.toEqual({
      message: "在庫状態を選び直してください。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });
});
