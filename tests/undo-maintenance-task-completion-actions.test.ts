import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, revalidatePathMock, undoTaskMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  undoTaskMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ undoTaskCompletion: undoTaskMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { D1ConflictError, type D1ErrorCode } from "../src/lib/d1/errors";
import { undoMaintenanceTaskCompletion } from "../src/features/todos/actions/completion";


// Issue #369: 案内の選択はD1層の識別コードだけで決まる。内部の英文メッセージを
// 判定に使っていないことを確かめるため、実際とは違う英文を持たせる。
function d1Error(code: D1ErrorCode): Error {
  return new D1ConflictError("internal detail that must not reach the screen", code);
}

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
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos");
    // 取消後に未完了へ戻った状態は、Todo詳細にも反映される(Issue #205)。
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos/occurrence-id");
    expect(result).toEqual({ message: "完了の取消を記録しました。", status: "success" });
  });

  it.each<[D1ErrorCode, string]>([
    ["NEXT_OCCURRENCE_MODIFIED", "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。"],
    ["OCCURRENCE_NOT_COMPLETED", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の識別コード %s を利用者向け案内へ変換する", async (code, expected) => {
    undoTaskMock.mockRejectedValue(d1Error(code));
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
