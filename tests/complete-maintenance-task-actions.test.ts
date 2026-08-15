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

import { completeMaintenanceTask } from "../app/managed-items/[id]/actions";

describe("メンテナンスTodoの完了操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "next-occurrence-id", error: null });
  });

  it("現在時刻での完了ではoccurred_atとperformed_by_user_idを送らずRPCへ渡す", async () => {
    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-1",
      null,
      null,
    );

    expect(rpcMock).toHaveBeenCalledWith("complete_maintenance_task", {
      idempotency_key: "idempotency-key-1",
      occurrence_id: "occurrence-id",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(result).toEqual({
      message: "完了を記録しました。",
      status: "success",
    });
  });

  it("バックデート完了では実施日を日本時間のUTC ISOへ変換して渡す", async () => {
    await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-2",
      "2026-08-01",
      null,
    );

    expect(rpcMock).toHaveBeenCalledWith("complete_maintenance_task", {
      idempotency_key: "idempotency-key-2",
      occurrence_id: "occurrence-id",
      occurred_at: "2026-07-31T15:00:00.000Z",
    });
  });

  it("無効な実施日はRPCへ送らない", async () => {
    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-2b",
      "2026-02-30",
      null,
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "実施日を正しく入力してください。",
      status: "error",
    });
  });

  it("実施者を指定した場合はperformed_by_user_idをRPCへ渡す", async () => {
    await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-2c",
      null,
      "other-member-id",
    );

    expect(rpcMock).toHaveBeenCalledWith("complete_maintenance_task", {
      idempotency_key: "idempotency-key-2c",
      occurrence_id: "occurrence-id",
      performed_by_user_id: "other-member-id",
    });
  });

  it("既完了などの競合エラーでは最新状態の確認を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Occurrence is not pending" },
    });

    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-3",
      null,
      null,
    );

    expect(result).toEqual({
      message: "他の操作で状態が変わりました。最新の状態を確認してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("バックデートで次回予定が衝突する場合は別の日付を促す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "Next occurrence already exists for the computed schedule",
      },
    });

    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-3b",
      "2020-03-10",
      null,
    );

    expect(result).toEqual({
      message:
        "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("実施者が同じ家庭のメンバーでない場合は選び直しを案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Performer not found" },
    });

    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-3c",
      null,
      "other-household-member-id",
    );

    expect(result).toEqual({
      message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示せず再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "sensitive database detail" },
    });

    const result = await completeMaintenanceTask(
      "managed-item-id",
      "occurrence-id",
      "idempotency-key-4",
      null,
      null,
    );

    expect(result).toEqual({
      message: "完了を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
