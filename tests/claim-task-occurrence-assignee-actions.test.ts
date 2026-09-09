import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimAssigneeMock, getD1ContextMock, revalidatePathMock } = vi.hoisted(() => ({
  claimAssigneeMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ claimTaskOccurrenceAssignee: claimAssigneeMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { D1ConflictError, type D1ErrorCode } from "../src/lib/d1/errors";
import { claimTaskOccurrenceAssignee } from "../src/features/todos/actions/assignee";


// Issue #369: 案内の選択はD1層の識別コードだけで決まる。内部の英文メッセージを
// 判定に使っていないことを確かめるため、実際とは違う英文を持たせる。
function d1Error(code: D1ErrorCode): Error {
  return new D1ConflictError("internal detail that must not reach the screen", code);
}

describe("未担当Todoを「やるよ」で引き受ける操作(Issue #77)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    claimAssigneeMock.mockResolvedValue(undefined);
  });

  it("対象Occurrenceだけを渡し、担当者IDは渡さない(操作主体はD1関数側がセッションから決める)", async () => {
    const result = await claimTaskOccurrenceAssignee("managed-item-id", "occurrence-id");

    expect(claimAssigneeMock).toHaveBeenCalledWith("db", "session", "occurrence-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "担当にしました。", status: "success" });
  });

  it.each<[D1ErrorCode, string]>([
    ["OCCURRENCE_ALREADY_ASSIGNED", "すでに他の家族が担当しています。最新の状態を確認してください。"],
    ["OCCURRENCE_NOT_PENDING", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の識別コード %s を利用者向け案内へ変換する", async (code, expected) => {
    claimAssigneeMock.mockRejectedValue(d1Error(code));
    const result = await claimTaskOccurrenceAssignee("managed-item-id", "occurrence-id");
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    claimAssigneeMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await claimTaskOccurrenceAssignee("managed-item-id", "occurrence-id");
    expect(result).toEqual({
      message: "担当を開始できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
