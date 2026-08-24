import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  getD1DatabaseMock,
  hashPasswordMock,
  registerInvitedUserMock,
  revalidatePathMock,
  signInMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getD1DatabaseMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  registerInvitedUserMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock("../src/auth", () => ({ signIn: signInMock }));
vi.mock("../src/lib/auth/password", () => ({
  MIN_PASSWORD_LENGTH: 8,
  hashPassword: hashPasswordMock,
}));
vi.mock("../src/lib/d1/client", () => ({ getD1Database: getD1DatabaseMock }));
vi.mock("../src/lib/d1/invitations", () => ({ registerInvitedUser: registerInvitedUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { registerFromInvitation } from "../src/app/invitations/accept/confirm/registration-actions";
import { D1ConflictError } from "../src/lib/d1/errors";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function registration(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("email", "new@example.test");
  formData.set("nickname", "New member");
  formData.set("password", "invited-password-value");
  formData.set("passwordConfirmation", "invited-password-value");
  Object.entries(overrides).forEach(([key, value]) => {
    formData.set(key, value);
  });
  return formData;
}

function cookieStore(claimSecret: string | undefined) {
  const deleteMock = vi.fn();
  return {
    deleteMock,
    store: {
      delete: deleteMock,
      get: vi.fn().mockReturnValue(
        claimSecret === undefined ? undefined : { value: claimSecret },
      ),
    },
  };
}

describe("招待限定の新規アカウント登録", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1DatabaseMock.mockResolvedValue("db");
    hashPasswordMock.mockResolvedValue("password-hash");
    registerInvitedUserMock.mockResolvedValue({
      email: "new@example.test",
      id: "new-user",
      sessionVersion: 0,
    });
    signInMock.mockResolvedValue(undefined);
  });

  it("claim・email・nickname・passwordをD1原子登録へ渡し、登録後にログインする", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);

    await registerFromInvitation(INITIAL_STATE, registration());

    expect(hashPasswordMock).toHaveBeenCalledWith("invited-password-value");
    expect(registerInvitedUserMock).toHaveBeenCalledWith("db", {
      claimSecret: "claim-secret",
      email: "new@example.test",
      nickname: "New member",
      passwordHash: "password-hash",
    });
    expect(deleteMock).toHaveBeenCalled();
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "new@example.test",
      password: "invited-password-value",
      redirectTo: "/",
    });
  });

  it("claimなし・短いpassword・確認不一致をD1へ送らない", async () => {
    cookiesMock.mockResolvedValue(cookieStore(undefined).store);
    await expect(registerFromInvitation(INITIAL_STATE, registration()))
      .resolves.toMatchObject({ status: "error" });

    cookiesMock.mockResolvedValue(cookieStore("claim-secret").store);
    await expect(registerFromInvitation(INITIAL_STATE, registration({ password: "short" })))
      .resolves.toMatchObject({ status: "error" });
    await expect(registerFromInvitation(
      INITIAL_STATE,
      registration({ passwordConfirmation: "different-password" }),
    )).resolves.toMatchObject({ status: "error" });
    expect(registerInvitedUserMock).not.toHaveBeenCalled();
  });

  it("無効な招待の内部詳細を表示せずcookieを使い切る", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);
    registerInvitedUserMock.mockRejectedValue(new D1ConflictError("email mismatch detail"));

    const result = await registerFromInvitation(INITIAL_STATE, registration());

    expect(result).toEqual({ message: "この招待は利用できません。", status: "error" });
    expect(JSON.stringify(result)).not.toContain("email mismatch detail");
    expect(deleteMock).toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("想定外のD1障害ではclaim cookieを保持して再試行できる", async () => {
    const { deleteMock, store } = cookieStore("claim-secret");
    cookiesMock.mockResolvedValue(store);
    registerInvitedUserMock.mockRejectedValue(new Error("D1 unavailable"));

    await expect(registerFromInvitation(INITIAL_STATE, registration()))
      .rejects.toThrow("D1 unavailable");
    expect(deleteMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });
});
