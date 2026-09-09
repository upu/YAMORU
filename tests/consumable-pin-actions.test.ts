import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  revalidatePathMock,
  setConsumablePinnedInD1Mock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setConsumablePinnedInD1Mock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumable-pins", () => ({
  setConsumablePinned: setConsumablePinnedInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateConsumablePin } from "../src/app/consumables/pin-actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function form(pinned: string, id = "consumable-1"): FormData {
  const data = new FormData();
  data.set("id", id);
  data.set("pinned", pinned);
  return data;
}

describe("Consumableピン留め操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    setConsumablePinnedInD1Mock.mockResolvedValue(undefined);
  });

  it.each([
    ["true", true, "ホームにピン留めしました。"],
    ["false", false, "ピン留めを外しました。"],
  ] as const)("%sを個人のピン留め設定へ反映する", async (raw, pinned, message) => {
    await expect(updateConsumablePin(INITIAL_STATE, form(raw))).resolves.toEqual({
      message,
      status: "success",
    });
    expect(setConsumablePinnedInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "consumable-1",
      pinned,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables/consumable-1");
  });

  it("不正な値をD1へ送らない", async () => {
    await expect(updateConsumablePin(INITIAL_STATE, form("yes"))).resolves.toEqual({
      message: "ピン留め設定を選び直してください。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });
});
