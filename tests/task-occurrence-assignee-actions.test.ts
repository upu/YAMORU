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

import { setTaskOccurrenceAssignee } from "../app/managed-items/[id]/actions";

describe("Todoの担当変更操作(Issue #72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("担当者を指定する場合はnew_assignee_user_idを付けてRPCへ渡す", async () => {
    const result = await setTaskOccurrenceAssignee(
      "managed-item-id",
      "occurrence-id",
      "member-user-id",
    );

    expect(rpcMock).toHaveBeenCalledWith("set_task_occurrence_assignee", {
      occurrence_id: "occurrence-id",
      new_assignee_user_id: "member-user-id",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "担当を変更しました。", status: "success" });
  });

  it("解除(誰でも可へ戻す)ではnew_assignee_user_idキーを省略する", async () => {
    await setTaskOccurrenceAssignee("managed-item-id", "occurrence-id", null);

    expect(rpcMock).toHaveBeenCalledWith("set_task_occurrence_assignee", {
      occurrence_id: "occurrence-id",
    });
  });

  it("他家庭の利用者などAssignee not foundは同じ家庭のメンバーを選ぶよう案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Assignee not found" },
    });

    const result = await setTaskOccurrenceAssignee(
      "managed-item-id",
      "occurrence-id",
      "other-household-user-id",
    );

    expect(result).toEqual({
      message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("完了済みなどの競合エラーでは最新状態の確認を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Occurrence is not pending" },
    });

    const result = await setTaskOccurrenceAssignee(
      "managed-item-id",
      "occurrence-id",
      "member-user-id",
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

    const result = await setTaskOccurrenceAssignee(
      "managed-item-id",
      "occurrence-id",
      "member-user-id",
    );

    expect(result).toEqual({
      message: "担当を変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
