import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, redirectMock, revalidatePathMock, rpcMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    rpcMock: vi.fn(),
  }),
);

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { createFirstHousehold } from "../app/account/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function householdForm(name: string) {
  const formData = new FormData();
  formData.set("householdName", name);
  return formData;
}

describe("最初の家庭作成操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "household-id", error: null });
  });

  it("家庭名の前後空白を除き、限定RPCだけへ渡す", async () => {
    await createFirstHousehold(INITIAL_STATE, householdForm("  テスト家庭  "));

    expect(rpcMock).toHaveBeenCalledWith("create_first_household", {
      household_name: "テスト家庭",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効な家庭名(%s)はRPCへ送信しない",
    async (name) => {
      const result = await createFirstHousehold(INITIAL_STATE, householdForm(name));

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "家庭名は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("作成失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await createFirstHousehold(
      INITIAL_STATE,
      householdForm("テスト家庭"),
    );

    expect(result).toEqual({
      message: "家庭を作成できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
