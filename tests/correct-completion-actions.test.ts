import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  correctCompletionOccurredAtMock,
  correctCompletionPerformerMock,
  getD1ContextMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  correctCompletionOccurredAtMock: vi.fn(),
  correctCompletionPerformerMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  correctCompletionOccurredAt: correctCompletionOccurredAtMock,
  correctCompletionPerformer: correctCompletionPerformerMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  correctCompletionOccurredAt,
  correctCompletionPerformer,
} from "../src/app/managed-items/[id]/actions";

describe("実施日時の訂正操作(Issue #148)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    correctCompletionOccurredAtMock.mockResolvedValue(undefined);
  });

  it("Asia/Tokyoの日付としてUTCへ変換しD1へ渡す", async () => {
    const result = await correctCompletionOccurredAt(
      "managed-item-id", "occurrence-id", "idempotency-key", "2026-08-05",
    );
    expect(correctCompletionOccurredAtMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "idempotency-key", "2026-08-04T15:00:00.000Z",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos");
    // 訂正後の実施記録はTodo詳細にも表示される(Issue #205)。
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos/occurrence-id");
    expect(result).toEqual({ message: "実施日時を訂正しました。", status: "success" });
  });

  it("不正な日付形式はD1へ送らない", async () => {
    const result = await correctCompletionOccurredAt(
      "managed-item-id", "occurrence-id", "idempotency-key", "not-a-date",
    );
    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "実施日を正しく入力してください。", status: "error" });
  });

  it.each([
    [
      "Next occurrence has been modified",
      "次回Todoがすでに変更されているため、実施日時を訂正できません。次回Todoを手動で調整してください。",
    ],
    ["Occurrence is not completed", "他の操作で状態が変わりました。最新の状態を確認してください。"],
    [
      "already exists for the computed schedule",
      "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
    ],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    correctCompletionOccurredAtMock.mockRejectedValue(new Error(message));
    const result = await correctCompletionOccurredAt(
      "managed-item-id", "occurrence-id", "idempotency-key", "2026-08-05",
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    correctCompletionOccurredAtMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await correctCompletionOccurredAt(
      "managed-item-id", "occurrence-id", "idempotency-key", "2026-08-05",
    );
    expect(result).toEqual({
      message: "実施日時を訂正できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});

describe("実施者の訂正操作(Issue #148)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    correctCompletionPerformerMock.mockResolvedValue(undefined);
  });

  it("同じOccurrenceへ実施者訂正アクションを呼び、両画面を再検証する", async () => {
    const result = await correctCompletionPerformer(
      "managed-item-id", "occurrence-id", "idempotency-key", "user-other",
    );
    expect(correctCompletionPerformerMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "idempotency-key", "user-other",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "実施者を訂正しました。", status: "success" });
  });

  it.each([
    [
      "Performer not found",
      "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
    ],
    ["Occurrence is not completed", "他の操作で状態が変わりました。最新の状態を確認してください。"],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    correctCompletionPerformerMock.mockRejectedValue(new Error(message));
    const result = await correctCompletionPerformer(
      "managed-item-id", "occurrence-id", "idempotency-key", "user-other",
    );
    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    correctCompletionPerformerMock.mockRejectedValue(new Error("sensitive database detail"));
    const result = await correctCompletionPerformer(
      "managed-item-id", "occurrence-id", "idempotency-key", "user-other",
    );
    expect(result).toEqual({
      message: "実施者を訂正できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
  });
});
