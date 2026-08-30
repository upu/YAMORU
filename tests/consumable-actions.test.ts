import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createConsumableInD1Mock,
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateConsumableInD1Mock,
} = vi.hoisted(() => ({
  createConsumableInD1Mock: vi.fn(),
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateConsumableInD1Mock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumables", () => ({
  createConsumable: createConsumableInD1Mock,
  updateConsumable: updateConsumableInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { createConsumable, updateConsumable } from "../src/app/consumables/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function form(overrides: Record<string, string | string[]> = {}) {
  const data = new FormData();
  data.set("name", "交換フィルター");
  data.set("note", "予備は棚の中");
  data.set("productCode", "FILTER-A");
  data.set("externalUrl", "https://example.com/filter");
  for (const [key, raw] of Object.entries(overrides)) {
    data.delete(key);
    for (const value of Array.isArray(raw) ? raw : [raw]) data.append(key, value);
  }
  return data;
}

describe("Consumable登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createConsumableInD1Mock.mockResolvedValue("consumable-id");
  });

  it("家庭IDを受け取らず、関連なしでも整形済み入力を保存する", async () => {
    await createConsumable(INITIAL_STATE, form({
      externalUrl: "",
      managedItemIds: [],
      name: "  トイレットペーパー  ",
      note: "",
      productCode: "",
      taskRuleIds: [],
    }));

    expect(createConsumableInD1Mock).toHaveBeenCalledWith("db", "session", {
      externalUrl: null,
      managedItemIds: [],
      name: "トイレットペーパー",
      note: null,
      productCode: null,
      taskRuleIds: [],
    });
    expect(redirectMock).toHaveBeenCalledWith("/consumables/consumable-id");
  });

  it("選択した複数のManagedItem・Todo IDを重複なく渡す", async () => {
    await createConsumable(INITIAL_STATE, form({
      managedItemIds: ["item-1", "item-2", "item-1"],
      taskRuleIds: ["rule-1", "rule-1"],
    }));

    expect(createConsumableInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({
        managedItemIds: ["item-1", "item-2"],
        taskRuleIds: ["rule-1"],
      }),
    );
  });

  it.each([
    ["name", "", "名前は1文字以上100文字以内で入力してください。"],
    ["name", "あ".repeat(101), "名前は1文字以上100文字以内で入力してください。"],
    ["note", "あ".repeat(1001), "メモは1000文字以内で入力してください。"],
    ["productCode", "あ".repeat(201), "型番・品番は200文字以内で入力してください。"],
    ["externalUrl", "javascript:alert(1)", "外部リンクはhttpまたはhttpsの絶対URLで入力してください。"],
  ])("無効な%sをD1へ送らない", async (field, value, message) => {
    const result = await createConsumable(INITIAL_STATE, form({ [field]: value }));

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message, status: "error" });
  });
});

describe("Consumable編集操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateConsumableInD1Mock.mockResolvedValue(undefined);
  });

  it("関連を空にしてもConsumableを更新し、詳細へ戻す", async () => {
    await updateConsumable(INITIAL_STATE, form({
      id: "consumable-id",
      managedItemIds: [],
      taskRuleIds: [],
    }));

    expect(updateConsumableInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "consumable-id",
      expect.objectContaining({ managedItemIds: [], taskRuleIds: [] }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/consumables/consumable-id");
    expect(redirectMock).toHaveBeenCalledWith("/consumables/consumable-id");
  });
});
