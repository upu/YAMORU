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

import { postponeTaskOccurrence } from "../app/managed-items/[id]/actions";

describe("未完了Todoの延期操作(Issue #19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("Asia/Tokyoの日付としてUTCへ変換し、postpone_task_occurrenceへ渡す", async () => {
    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "2026-09-01",
    );

    expect(rpcMock).toHaveBeenCalledWith("postpone_task_occurrence", {
      occurrence_id: "occurrence-id",
      new_due_at: "2026-08-31T15:00:00.000Z",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result.status).toBe("success");
    expect(result.message).toContain("延期しました");
  });

  it("不正な日付形式は延期する日付の入力を促し、RPCを呼ばない", async () => {
    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "not-a-date",
    );

    expect(rpcMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "延期する日付を正しく入力してください。",
      status: "error",
    });
  });

  it("過去日・当日を指定した場合は未来日を促す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "new_due_at must be in the future" },
    });

    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "2026-01-01",
    );

    expect(result).toEqual({
      message: "延期する日付は未来の日を指定してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("本来の予定日より前を指定した場合はその旨を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "new_due_at must not be before scheduled_for" },
    });

    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "2026-09-01",
    );

    expect(result).toEqual({
      message: "本来の予定日より前には延期できません。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("完了済みなどの競合エラーでは最新状態の確認を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Occurrence is not pending" },
    });

    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "2026-09-01",
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

    const result = await postponeTaskOccurrence(
      "managed-item-id",
      "occurrence-id",
      "2026-09-01",
    );

    expect(result).toEqual({
      message: "延期を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
