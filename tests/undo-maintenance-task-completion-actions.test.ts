import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, revalidatePathMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { undoMaintenanceTaskCompletion } from "../app/managed-items/[id]/actions";

describe("メンテナンスTodo完了の取消操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "occurrence-id", error: null });
  });

  it("occurrenceIdと冪等性キーをRPCへ渡す", async () => {
    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-1",
    );

    expect(rpcMock).toHaveBeenCalledWith("undo_maintenance_task_completion", {
      idempotency_key: "idempotency-key-1",
      occurrence_id: "occurrence-id",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({
      message: "完了の取消を記録しました。",
      status: "success",
    });
  });

  it("次回Todoが変更済みの場合は手動訂正を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Next occurrence has been modified" },
    });

    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-2",
    );

    expect(result).toEqual({
      message: "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("既に取消済みなどの競合エラーでは最新状態の確認を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Occurrence is not completed" },
    });

    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-3",
    );

    expect(result).toEqual({
      message: "他の操作で状態が変わりました。最新の状態を確認してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示せず再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "sensitive database detail" },
    });

    const result = await undoMaintenanceTaskCompletion(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-4",
    );

    expect(result).toEqual({
      message: "取消を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
