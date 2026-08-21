import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  changePasswordMock,
  getD1DatabaseMock,
  redirectMock,
  requireUserMock,
  revalidatePathMock,
  signOutMock,
} = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
  getD1DatabaseMock: vi.fn(),
  redirectMock: vi.fn(),
  requireUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("../auth", () => ({ signOut: signOutMock }));
vi.mock("../lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../lib/d1/authentication", () => ({ changePassword: changePasswordMock }));
vi.mock("../lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { updatePassword } from "../app/account/password-actions";
import { D1UnauthorizedError } from "../lib/d1/errors";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function passwords(
  currentPassword = "current-password-value",
  newPassword = "new-password-value",
  confirmation = newPassword,
) {
  const formData = new FormData();
  formData.set("currentPassword", currentPassword);
  formData.set("newPassword", newPassword);
  formData.set("newPasswordConfirmation", confirmation);
  return formData;
}

describe("ログイン中のパスワード変更", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      email: "person@example.test",
      id: "user-1",
      sessionVersion: 3,
    });
    getD1DatabaseMock.mockResolvedValue("db");
    changePasswordMock.mockResolvedValue(undefined);
    signOutMock.mockResolvedValue(undefined);
  });

  it("現在パスワードを再確認してhashとsession_versionを更新し、自分もログアウトする", async () => {
    await updatePassword(INITIAL_STATE, passwords());

    expect(changePasswordMock).toHaveBeenCalledWith(
      "db",
      { sessionVersion: 3, userId: "user-1" },
      "current-password-value",
      "new-password-value",
    );
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/login?passwordChanged=1");
  });

  it("短い新passwordと確認不一致はD1へ送らない", async () => {
    await expect(updatePassword(INITIAL_STATE, passwords(undefined, "short")))
      .resolves.toMatchObject({ status: "error" });
    await expect(updatePassword(INITIAL_STATE, passwords(undefined, undefined, "different")))
      .resolves.toMatchObject({ status: "error" });
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("現在passwordが違う場合は内部詳細を隠してログアウトしない", async () => {
    changePasswordMock.mockRejectedValue(new D1UnauthorizedError("password hash mismatch"));

    const result = await updatePassword(INITIAL_STATE, passwords());

    expect(result).toEqual({
      message: "現在のパスワードを確認してください。",
      status: "error",
    });
    expect(JSON.stringify(result)).not.toContain("hash mismatch");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("想定外のD1障害をパスワード不一致として隠さない", async () => {
    changePasswordMock.mockRejectedValue(new Error("D1 unavailable"));

    await expect(updatePassword(INITIAL_STATE, passwords()))
      .rejects.toThrow("D1 unavailable");
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
