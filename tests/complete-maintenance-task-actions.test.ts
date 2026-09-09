import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeTaskMock, getD1ContextMock, revalidatePathMock } = vi.hoisted(() => ({
  completeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ completeTask: completeTaskMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { D1ConflictError, type D1ErrorCode } from "../src/lib/d1/errors";
import { completeMaintenanceTask } from "../src/features/todos/actions/completion";


// Issue #369: 案内の選択はD1層の識別コードだけで決まる。内部の英文メッセージを
// 判定に使っていないことを確かめるため、実際とは違う英文を持たせる。
function d1Error(code: D1ErrorCode): Error {
  return new D1ConflictError("internal detail that must not reach the screen", code);
}

describe("メンテナンスTodoの完了操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    completeTaskMock.mockResolvedValue("next-occurrence-id");
  });

  it("現在時刻での完了では任意項目をnullとしてD1へ渡す", async () => {
    const result = await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-1", null, null,
    );
    expect(completeTaskMock).toHaveBeenCalledWith("db", "session", {
      idempotencyKey: "idempotency-key-1",
      occurredAt: null,
      occurrenceId: "occurrence-id",
      performedByUserId: null,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/search");
    expect(result).toEqual({ message: "完了を記録しました。", status: "success" });
  });

  it("バックデート完了では実施日を日本時間のUTC ISOへ変換して渡す", async () => {
    await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-2", "2026-08-01", null,
    );
    expect(completeTaskMock).toHaveBeenCalledWith(
      "db", "session", expect.objectContaining({ occurredAt: "2026-07-31T15:00:00.000Z" }),
    );
  });

  it("無効な実施日はD1へ送らない", async () => {
    const result = await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-2b", "2026-02-30", null,
    );
    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "実施日を正しく入力してください。", status: "error" });
  });

  it("実施者を指定した場合はD1へ渡す", async () => {
    await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-2c", null, "other-member-id",
    );
    expect(completeTaskMock).toHaveBeenCalledWith(
      "db", "session", expect.objectContaining({ performedByUserId: "other-member-id" }),
    );
  });

  it.each<[D1ErrorCode, string]>([
    ["OCCURRENCE_NOT_PENDING", "他の操作で状態が変わりました。最新の状態を確認してください。"],
    ["NEXT_OCCURRENCE_SCHEDULE_TAKEN", "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。"],
    ["PERFORMER_NOT_FOUND", "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。"],
  ])("D1の識別コード %s を利用者向け案内へ変換する", async (code, expected) => {
    completeTaskMock.mockRejectedValue(d1Error(code));
    const result = await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-3", null, null,
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Issue #369: 以前は英文メッセージの部分一致で案内を選んでいた。識別コードを
  // 持たないエラーは、同じ英文でも既知エラーとして扱わない。
  it("識別コードのない英文メッセージは既知エラーとして扱わない", async () => {
    completeTaskMock.mockRejectedValue(new Error("Occurrence is not pending"));
    const result = await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-3b", null, null,
    );
    expect(result).toEqual({
      message: "完了を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    completeTaskMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await completeMaintenanceTask(
      "managed-item-id", "occurrence-id", "idempotency-key-4", null, null,
    );
    expect(result).toEqual({
      message: "完了を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
