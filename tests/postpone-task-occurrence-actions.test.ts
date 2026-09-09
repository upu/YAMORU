import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, postponeTaskMock, revalidatePathMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  postponeTaskMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({ postponeTaskOccurrence: postponeTaskMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { D1ConflictError, type D1ErrorCode } from "../src/lib/d1/errors";
import { postponeTaskOccurrence } from "../src/features/todos/actions/schedule";


// Issue #369: 案内の選択はD1層の識別コードだけで決まる。内部の英文メッセージを
// 判定に使っていないことを確かめるため、実際とは違う英文を持たせる。
function d1Error(code: D1ErrorCode): Error {
  return new D1ConflictError("internal detail that must not reach the screen", code);
}

describe("未完了Todoの延期操作(Issue #19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    postponeTaskMock.mockResolvedValue(undefined);
  });

  it("Asia/Tokyoの日付としてUTCへ変換しD1へ渡す", async () => {
    const result = await postponeTaskOccurrence(
      "managed-item-id", "occurrence-id", "2026-09-01",
    );
    expect(postponeTaskMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "2026-08-31T15:00:00.000Z",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result.status).toBe("success");
  });

  it("不正な日付形式はD1へ送らない", async () => {
    const result = await postponeTaskOccurrence(
      "managed-item-id", "occurrence-id", "not-a-date",
    );
    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "延期する日付を正しく入力してください。", status: "error" });
  });

  it.each<[D1ErrorCode, string]>([
    ["DUE_AT_NOT_IN_FUTURE", "延期する日付は未来の日を指定してください。"],
    ["DUE_AT_BEFORE_SCHEDULED_FOR", "本来の予定日より前には延期できません。"],
    ["OCCURRENCE_NOT_PENDING", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の識別コード %s を利用者向け案内へ変換する", async (code, expected) => {
    postponeTaskMock.mockRejectedValue(d1Error(code));
    const result = await postponeTaskOccurrence(
      "managed-item-id", "occurrence-id", "2026-09-01",
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    postponeTaskMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await postponeTaskOccurrence(
      "managed-item-id", "occurrence-id", "2026-09-01",
    );
    expect(result).toEqual({
      message: "延期を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
