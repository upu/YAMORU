import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  redirectMock,
  revalidatePathMock,
  insertMock,
  updateMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { registerNickname, updateNickname } from "../app/account/actions";

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

  it("安全なnextが指定されている場合はそこへ戻る(Issue #69: 招待受諾フロー復帰)", async () => {
    const formData = nicknameForm("たろう");
    formData.set("next", "/invitations/accept/confirm");

    await registerNickname(INITIAL_STATE, formData);

    expect(redirectMock).toHaveBeenCalledWith("/invitations/accept/confirm");
  });

  it.each(["https://evil.example.test/", "//evil.example.test", "/\\evil.example.test"])(
    "外部ドメインを指すnext(%s)は無視して既定のアカウント画面へ戻る",
    async (next) => {
      const formData = nicknameForm("たろう");
      formData.set("next", next);

      await registerNickname(INITIAL_STATE, formData);

      expect(redirectMock).toHaveBeenCalledWith("/account");
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

describe("ニックネーム編集操作(Issue #76)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    createClientMock.mockResolvedValue({ from: fromMock });
    updateMock.mockResolvedValue({ error: null });
  });

  it("ニックネームの前後空白を除いてupdateへ渡す(対象行はRLSのUSING句が絞るため、クライアント側でuser_idを指定しない)", async () => {
    await updateNickname(INITIAL_STATE, nicknameForm("  たろう二世  "));

    expect(updateMock).toHaveBeenCalledWith({ nickname: "たろう二世" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("更新成功時は成功状態と案内メッセージを返す(リダイレクトはしない)", async () => {
    const result = await updateNickname(INITIAL_STATE, nicknameForm("たろう二世"));

    expect(result).toEqual({
      message: "ニックネームを変更しました。",
      status: "success",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "あ".repeat(21)])(
    "無効なニックネーム(%s)はupdateを呼び出さない",
    async (nickname) => {
      const result = await updateNickname(INITIAL_STATE, nicknameForm(nickname));

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "ニックネームは1文字以上20文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("更新失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    updateMock.mockResolvedValue({ error: new Error("sensitive database detail") });

    const result = await updateNickname(INITIAL_STATE, nicknameForm("たろう二世"));

    expect(result).toEqual({
      message: "ニックネームを変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
