import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, revalidatePathMock, setAssigneeMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setAssigneeMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ setTaskOccurrenceAssignee: setAssigneeMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { setTaskOccurrenceAssignee } from "../src/app/managed-items/[id]/actions";

describe("Todoの担当変更操作(Issue #72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    setAssigneeMock.mockResolvedValue(undefined);
  });

  it("担当者をD1へ渡す", async () => {
    const result = await setTaskOccurrenceAssignee(
      "managed-item-id", "occurrence-id", "member-user-id",
    );
    expect(setAssigneeMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "member-user-id",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "担当を変更しました。", status: "success" });
  });

  it("解除ではnullをD1へ渡す", async () => {
    await setTaskOccurrenceAssignee("managed-item-id", "occurrence-id", null);
    expect(setAssigneeMock).toHaveBeenCalledWith("db", "session", "occurrence-id", null);
  });

  it.each([
    ["Assignee not found", "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。"],
    ["Occurrence is not pending", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    setAssigneeMock.mockRejectedValue(new Error(message));
    const result = await setTaskOccurrenceAssignee(
      "managed-item-id", "occurrence-id", "member-user-id",
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    setAssigneeMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await setTaskOccurrenceAssignee(
      "managed-item-id", "occurrence-id", "member-user-id",
    );
    expect(result).toEqual({
      message: "担当を変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
