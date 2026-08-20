import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createProfileMock,
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateProfileMock,
} = vi.hoisted(() => ({
  createProfileMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateProfileMock: vi.fn(),
}));

vi.mock("../lib/d1/context", () => ({
  getD1Context: getD1ContextMock,
}));

vi.mock("../lib/d1/households", () => ({
  createFirstHousehold: vi.fn(),
  createProfile: createProfileMock,
  updateProfile: updateProfileMock,
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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createProfileMock.mockResolvedValue(undefined);
  });

  it("ニックネームの前後空白を除き、insertへ渡す", async () => {
    await registerNickname(INITIAL_STATE, nicknameForm("  たろう  "));

    expect(createProfileMock).toHaveBeenCalledWith("db", "session", "たろう");
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it.each(["", "   ", "あ".repeat(21)])(
    "無効なニックネーム(%s)は登録処理を呼び出さない",
    async (nickname) => {
      const result = await registerNickname(INITIAL_STATE, nicknameForm(nickname));

      expect(getD1ContextMock).not.toHaveBeenCalled();
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
    createProfileMock.mockResolvedValue(undefined);

    await registerNickname(INITIAL_STATE, nicknameForm("たろう"));

    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(redirectMock).toHaveBeenCalledWith("/account");
  });

  it("登録失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    createProfileMock.mockRejectedValue(new Error("sensitive database detail"));

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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateProfileMock.mockResolvedValue(undefined);
  });

  it("ニックネームの前後空白を除き、現在の利用者IDに絞ってupdateへ渡す(PostgRESTはWHERE句のないUPDATEを拒否するため必須)", async () => {
    await updateNickname(INITIAL_STATE, nicknameForm("  たろう二世  "));

    expect(updateProfileMock).toHaveBeenCalledWith(
      "db",
      "session",
      "たろう二世",
    );
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

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "ニックネームは1文字以上20文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("未ログインの場合はログイン画面へ戻す", async () => {
    getD1ContextMock.mockRejectedValue(new Error("Authentication required"));

    const result = await updateNickname(INITIAL_STATE, nicknameForm("たろう二世"));

    expect(result.status).toBe("error");
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("更新失敗の内部詳細を表示せず、再試行できる案内を返す", async () => {
    updateProfileMock.mockRejectedValue(new Error("sensitive database detail"));

    const result = await updateNickname(INITIAL_STATE, nicknameForm("たろう二世"));

    expect(result).toEqual({
      message: "ニックネームを変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
