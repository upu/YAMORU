import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, postponeTaskMock, revalidatePathMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  postponeTaskMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../lib/d1/todos", () => ({ postponeTaskOccurrence: postponeTaskMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { postponeTaskOccurrence } from "../app/managed-items/[id]/actions";

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

  it.each([
    ["new_due_at must be in the future", "延期する日付は未来の日を指定してください。"],
    ["new_due_at must not be before scheduled_for", "本来の予定日より前には延期できません。"],
    ["Occurrence is not pending", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    postponeTaskMock.mockRejectedValue(new Error(message));
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
