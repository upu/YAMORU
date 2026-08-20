import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, revalidatePathMock, undoTaskMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  undoTaskMock: vi.fn(),
}));

vi.mock("../lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../lib/d1/todos", () => ({ undoTaskCompletion: undoTaskMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { undoMaintenanceTaskCompletion } from "../app/managed-items/[id]/actions";

describe("メンテナンスTodo完了の取消操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    undoTaskMock.mockResolvedValue(undefined);
  });

  it("Occurrence IDと冪等性キーをD1へ渡す", async () => {
    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id", "occurrence-id", "idempotency-key-1",
    );
    expect(undoTaskMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "idempotency-key-1",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "完了の取消を記録しました。", status: "success" });
  });

  it.each([
    ["Next occurrence has been modified", "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。"],
    ["Occurrence is not completed", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    undoTaskMock.mockRejectedValue(new Error(message));
    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id", "occurrence-id", "idempotency-key-2",
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    undoTaskMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id", "occurrence-id", "idempotency-key-4",
    );
    expect(result).toEqual({
      message: "取消を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
