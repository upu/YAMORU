import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  redirectMock,
  revalidatePathMock,
  signInWithPasswordMock,
  signOutMock,
  signUpMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  signOutMock: vi.fn(),
  signUpMock: vi.fn(),
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

import { login, signup } from "../app/login/actions";
import { POST as signOut } from "../app/auth/signout/route";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function credentials(email = "person@example.test", password = "test-password") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

describe("認証操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({
      auth: {
        signInWithPassword: signInWithPasswordMock,
        signUp: signUpMock,
      },
    });
    signInWithPasswordMock.mockResolvedValue({ error: null });
    signUpMock.mockResolvedValue({ error: null });
  });

  it("メールアドレスとパスワードでログインし、保護画面へ移動する", async () => {
    await login(INITIAL_STATE, credentials());

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "person@example.test",
      password: "test-password",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("架空の利用者を新規登録し、保護画面へ移動する", async () => {
    await signup(INITIAL_STATE, credentials("new-person@example.test"));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "new-person@example.test",
      password: "test-password",
    });
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("安全なnextが指定されている場合はログイン後にそこへ戻る(Issue #69: 招待受諾フロー復帰)", async () => {
    const formData = credentials();
    formData.set("next", "/invitations/accept/confirm");

    await login(INITIAL_STATE, formData);

    expect(redirectMock).toHaveBeenCalledWith("/invitations/accept/confirm");
  });

  it("安全なnextが指定されている場合は新規登録後にそこへ戻る", async () => {
    const formData = credentials("new-person@example.test");
    formData.set("next", "/invitations/accept/confirm");

    await signup(INITIAL_STATE, formData);

    expect(redirectMock).toHaveBeenCalledWith("/invitations/accept/confirm");
  });

  it.each(["https://evil.example.test/", "//evil.example.test", "/\\evil.example.test"])(
    "外部ドメインを指すnext(%s)は無視して既定のホームへ戻る",
    async (next) => {
      const formData = credentials();
      formData.set("next", next);

      await login(INITIAL_STATE, formData);

      expect(redirectMock).toHaveBeenCalledWith("/");
    },
  );

  it("認証エラーの内部詳細をそのまま表示しない", async () => {
    signInWithPasswordMock.mockResolvedValue({
      error: new Error("sensitive provider detail"),
    });

    const result = await login(INITIAL_STATE, credentials());

    expect(result).toEqual({
      message: "メールアドレスまたはパスワードを確認してください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive provider detail");
  });

  it("不正な入力はAuthへ送信せず、利用者へ案内する", async () => {
    const result = await signup(INITIAL_STATE, credentials("invalid", "short"));

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "メールアドレスと6文字以上のパスワードを入力してください。",
      status: "error",
    });
  });

  it("認証済み利用者をログアウトし、ログイン画面へ戻す", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-id" } },
        }),
        signOut: signOutMock.mockResolvedValue({ error: null }),
      },
    });

    const response = await signOut();

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("未認証の場合はAuthのログアウト処理を呼ばない", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null }),
        signOut: signOutMock,
      },
    });

    await signOut();

    expect(signOutMock).not.toHaveBeenCalled();
  });
});
