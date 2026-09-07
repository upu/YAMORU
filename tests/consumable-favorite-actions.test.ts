import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  revalidatePathMock,
  setConsumableFavoriteInD1Mock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setConsumableFavoriteInD1Mock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumable-favorites", () => ({
  setConsumableFavorite: setConsumableFavoriteInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateConsumableFavorite } from "../src/app/consumables/favorite-actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function form(favorite: string, id = "consumable-1"): FormData {
  const data = new FormData();
  data.set("id", id);
  data.set("favorite", favorite);
  return data;
}

describe("Consumableお気に入り操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    setConsumableFavoriteInD1Mock.mockResolvedValue(undefined);
  });

  it.each([
    ["true", true, "お気に入りに追加しました。"],
    ["false", false, "お気に入りから外しました。"],
  ] as const)("%sを個人のお気に入り設定へ反映する", async (raw, favorite, message) => {
    await expect(updateConsumableFavorite(INITIAL_STATE, form(raw))).resolves.toEqual({
      message,
      status: "success",
    });
    expect(setConsumableFavoriteInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "consumable-1",
      favorite,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables/consumable-1");
  });

  it("不正な値をD1へ送らない", async () => {
    await expect(updateConsumableFavorite(INITIAL_STATE, form("yes"))).resolves.toEqual({
      message: "お気に入り設定を選び直してください。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });
});
