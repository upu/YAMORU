import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createManagedItemInD1Mock,
  getD1ContextMock,
  recordItemTypeAdoptionMock,
  redirectMock,
  revalidatePathMock,
  updateManagedItemInD1Mock,
} = vi.hoisted(() => ({
  createManagedItemInD1Mock: vi.fn(),
  getD1ContextMock: vi.fn(),
  recordItemTypeAdoptionMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateManagedItemInD1Mock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/item-type-suggestions", () => ({
  recordItemTypeAdoption: recordItemTypeAdoptionMock,
}));
vi.mock("../src/lib/d1/managed-items", () => ({
  createManagedItem: createManagedItemInD1Mock,
  updateManagedItem: updateManagedItemInD1Mock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { createManagedItem, updateManagedItem } from "../src/app/managed-items/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function managedItemForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string> = {
    customItemType: "",
    externalUrl: "",
    itemTypeCode: "appliance",
    kindCode: "asset",
    name: "デロンギ マグニフィカS",
    note: "",
    productInfo: "",
    startedDay: "",
    startedMonth: "",
    startedYear: "",
    ...overrides,
  };
  for (const [field, value] of Object.entries(values)) formData.set(field, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
  createManagedItemInD1Mock.mockResolvedValue("managed-item-id");
  recordItemTypeAdoptionMock.mockResolvedValue(undefined);
});

describe("AI提案の採用結果の記録(Issue #332)", () => {
  it("提案IDが送られたときだけ、最終的に採用された種類を記録する", async () => {
    await createManagedItem(
      INITIAL_STATE,
      managedItemForm({
        customItemType: "全自動コーヒーマシン",
        itemTypeCode: "__custom__",
        itemTypeSuggestionId: "suggestion-1",
      }),
    );

    expect(recordItemTypeAdoptionMock).toHaveBeenCalledWith("db", "session", {
      customItemType: "全自動コーヒーマシン",
      itemTypeCode: null,
      suggestionId: "suggestion-1",
    });
    expect(redirectMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
  });

  it("プリセットを選び直した場合も、そのコードを採用結果として渡す", async () => {
    await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ itemTypeSuggestionId: "suggestion-1" }),
    );

    expect(recordItemTypeAdoptionMock).toHaveBeenCalledWith("db", "session", {
      customItemType: null,
      itemTypeCode: "appliance",
      suggestionId: "suggestion-1",
    });
  });

  it("提案IDが無ければ何も記録しない(AIを使わない登録・候補を閉じた登録)", async () => {
    await createManagedItem(INITIAL_STATE, managedItemForm());

    expect(recordItemTypeAdoptionMock).not.toHaveBeenCalled();
  });

  it("入力エラーや登録失敗のときは採用結果を記録しない", async () => {
    await expect(createManagedItem(
      INITIAL_STATE,
      managedItemForm({ itemTypeSuggestionId: "suggestion-1", name: "" }),
    )).resolves.toMatchObject({ status: "error" });

    createManagedItemInD1Mock.mockRejectedValue(new Error("D1 error"));
    await expect(createManagedItem(
      INITIAL_STATE,
      managedItemForm({ itemTypeSuggestionId: "suggestion-1" }),
    )).resolves.toMatchObject({ status: "error" });

    expect(recordItemTypeAdoptionMock).not.toHaveBeenCalled();
  });

  it("履歴を残せなくても登録は完了として扱う", async () => {
    recordItemTypeAdoptionMock.mockRejectedValue(new Error("D1 error"));

    await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ itemTypeSuggestionId: "suggestion-1" }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
  });

  it("編集画面から採用された種類も同じように記録する", async () => {
    await updateManagedItem(
      INITIAL_STATE,
      managedItemForm({
        customItemType: "コーヒーマシン",
        id: "item-1",
        itemTypeCode: "__custom__",
        itemTypeSuggestionId: "suggestion-2",
      }),
    );

    expect(updateManagedItemInD1Mock).toHaveBeenCalled();
    expect(recordItemTypeAdoptionMock).toHaveBeenCalledWith("db", "session", {
      customItemType: "コーヒーマシン",
      itemTypeCode: null,
      suggestionId: "suggestion-2",
    });
    expect(redirectMock).toHaveBeenCalledWith("/managed-items/item-1");
  });
});
