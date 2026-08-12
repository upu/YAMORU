import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, redirectMock, revalidatePathMock, insertMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    insertMock: vi.fn(),
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

import { registerNickname } from "../app/account/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function nicknameForm(nickname: string) {
  const formData = new FormData();
  formData.set("nickname", nickname);
  return formData;
}

describe("ニックネーム登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
    createClientMock.mockResolvedValue({ from: fromMock });
    insertMock.mockResolvedValue({ error: null });
  });

  it("ニックネームの前後空白を除き、insertへ渡す", async () => {
    await registerNickname(INITIAL_STATE, nicknameForm("  たろう  "));

    expect(insertMock).toHaveBeenCalledWith({ nickname: "たろう" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it.each(["", "   ", "あ".repeat(21)])(
    "無効なニックネーム(%s)は登録処理を呼び出さない",
    async (nickname) => {
      const result = await registerNickname(INITIAL_STATE, nicknameForm(nickname));

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "ニックネームは1文字以上20文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("一意制約違反(二重送信)は成功として扱う", async () => {
    insertMock.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    });

    await registerNickname(INITIAL_STATE, nicknameForm("たろう"));

    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it("登録失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    insertMock.mockResolvedValue({
      error: new Error("sensitive database detail"),
    });

    const result = await registerNickname(INITIAL_STATE, nicknameForm("たろう"));

    expect(result).toEqual({
      message: "ニックネームを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
