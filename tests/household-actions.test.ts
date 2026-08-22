import { beforeEach, describe, expect, it, vi } from "vitest";

const { createFirstHouseholdInD1Mock, getD1ContextMock, redirectMock, revalidatePathMock } = vi.hoisted(
  () => ({
    createFirstHouseholdInD1Mock: vi.fn(),
    getD1ContextMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock("../lib/d1/context", () => ({
  getD1Context: getD1ContextMock,
}));

vi.mock("../lib/d1/households", () => ({
  createFirstHousehold: createFirstHouseholdInD1Mock,
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { createFirstHousehold } from "../app/household/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function householdForm(name: string) {
  const formData = new FormData();
  formData.set("householdName", name);
  return formData;
}

describe("最初の家庭作成操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createFirstHouseholdInD1Mock.mockResolvedValue(undefined);
  });

  it("家庭名の前後空白を除き、限定RPCだけへ渡す", async () => {
    await createFirstHousehold(INITIAL_STATE, householdForm("  テスト家庭  "));

    expect(createFirstHouseholdInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "テスト家庭",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効な家庭名(%s)はRPCへ送信しない",
    async (name) => {
      const result = await createFirstHousehold(INITIAL_STATE, householdForm(name));

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "家庭名は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("作成失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    createFirstHouseholdInD1Mock.mockRejectedValue(
      new Error("sensitive database detail"),
    );

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
