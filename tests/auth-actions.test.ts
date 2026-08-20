import { CredentialsSignin } from "@auth/core/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePathMock, signInMock, signOutMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("../auth", () => ({ signIn: signInMock, signOut: signOutMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { login } from "../app/login/actions";
import { POST as signOut } from "../app/auth/signout/route";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function credentials(email = "person@example.test", password = "test-password-value") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

describe("Auth.js認証操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockResolvedValue(undefined);
    signOutMock.mockResolvedValue(undefined);
  });

  it("Credentialsでログインし、安全な画面へ移動する", async () => {
    await login(INITIAL_STATE, credentials());

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "person@example.test",
      password: "test-password-value",
      redirectTo: "/",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("安全なnextが指定されている場合はログイン後にそこへ戻る", async () => {
    const formData = credentials();
    formData.set("next", "/invitations/accept/resume");

    await login(INITIAL_STATE, formData);

    expect(signInMock).toHaveBeenCalledWith("credentials", expect.objectContaining({
      redirectTo: "/invitations/accept/resume",
    }));
  });

  it.each(["https://evil.example.test/", "//evil.example.test", "/\\evil.example.test"])(
    "外部ドメインを指すnext(%s)は無視する",
    async (next) => {
      const formData = credentials();
      formData.set("next", next);

      await login(INITIAL_STATE, formData);

      expect(signInMock).toHaveBeenCalledWith("credentials", expect.objectContaining({
        redirectTo: "/",
      }));
    },
  );

  it("認証エラーの内部詳細を表示しない", async () => {
    signInMock.mockRejectedValue(new CredentialsSignin("sensitive provider detail"));

    const result = await login(INITIAL_STATE, credentials());

    expect(result).toEqual({
      message: "メールアドレスまたはパスワードを確認してください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive provider detail");
  });

  it("不正な入力はAuth.jsへ送信しない", async () => {
    const result = await login(INITIAL_STATE, credentials("invalid", "short"));

    expect(signInMock).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
  });

  it("Auth.jsのJWT cookieを破棄してログイン画面へ戻す", async () => {
    const response = await signOut();

    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });
});
