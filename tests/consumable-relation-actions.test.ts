import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  revalidatePathMock,
  setManagedItemRelationInD1Mock,
  setTaskRuleRelationInD1Mock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setManagedItemRelationInD1Mock: vi.fn(),
  setTaskRuleRelationInD1Mock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/consumables", () => ({
  setConsumableManagedItemRelation: setManagedItemRelationInD1Mock,
  setConsumableTaskRuleRelation: setTaskRuleRelationInD1Mock,
}));
vi.mock("../src/lib/d1/consumable-relations", () => ({
  searchConsumableManagedItemCandidates: vi.fn(),
  searchConsumableTaskRuleCandidates: vi.fn(),
}));

import {
  setConsumableManagedItemRelation,
  setConsumableTaskRuleRelation,
} from "../src/app/consumables/relation-actions";

// Issue #311: 消耗品詳細からの関連の追加・解除。家庭の絞り込みはD1層が行うため、
// ここでは引数の形と、更新後にどの画面を作り直すかだけを確かめる。
describe("消耗品の関連付けの追加・解除操作 (Issue #311)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    setManagedItemRelationInD1Mock.mockResolvedValue(undefined);
    setTaskRuleRelationInD1Mock.mockResolvedValue(undefined);
  });

  it("管理対象の追加を家庭IDなしでD1へ委ね、関連が見える画面を作り直す", async () => {
    await expect(setConsumableManagedItemRelation("  consumable-1  ", "item-1", true))
      .resolves.toEqual({ status: "ok" });

    expect(setManagedItemRelationInD1Mock)
      .toHaveBeenCalledWith("db", "session", "consumable-1", "item-1", true);
    expect(revalidatePathMock.mock.calls.flat()).toEqual([
      "/consumables",
      "/consumables/consumable-1",
      "/managed-items",
      "/todos",
    ]);
  });

  it("Todoの解除も同じ経路で扱う", async () => {
    await expect(setConsumableTaskRuleRelation("consumable-1", "rule-1", false))
      .resolves.toEqual({ status: "ok" });

    expect(setTaskRuleRelationInD1Mock)
      .toHaveBeenCalledWith("db", "session", "consumable-1", "rule-1", false);
  });

  it.each([
    ["消耗品ID", "", "item-1", true],
    ["関連先ID", "consumable-1", " ", true],
    ["切り替えの値", "consumable-1", "item-1", "yes"],
  ])("%sが想定した形でなければD1へ届かせない", async (_label, consumableId, relatedId, related) => {
    const result = await setConsumableManagedItemRelation(
      consumableId,
      relatedId,
      related as boolean,
    );

    expect(result).toEqual({
      message: "関連付ける対象を選び直してください。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("保存に失敗したら理由を返し、画面を作り直さない", async () => {
    setManagedItemRelationInD1Mock.mockRejectedValue(new Error("boom"));

    await expect(setConsumableManagedItemRelation("consumable-1", "item-1", true))
      .resolves.toEqual({
        message: "関連を更新できませんでした。時間をおいて再度お試しください。",
        status: "error",
      });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
