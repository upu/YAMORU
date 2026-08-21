import { beforeEach, describe, expect, it, vi } from "vitest";

import { D1ConflictError } from "../lib/d1/errors";

const { bootstrapFirstUserMock, resetPasswordMock } = vi.hoisted(() => ({
  bootstrapFirstUserMock: vi.fn(),
  resetPasswordMock: vi.fn(),
}));

vi.mock("../lib/d1/authentication", () => ({
  bootstrapFirstUser: bootstrapFirstUserMock,
  resetPassword: resetPasswordMock,
}));

import authAdminPlatform from "../scripts/auth-admin-platform";

const sessionToken = "temporary-session-token-for-tests";
const db = {} as D1Database;
const env = {
  AUTH_ADMIN_SESSION_TOKEN: sessionToken,
  DB: db,
};

function adminRequest(
  body: unknown,
  token = sessionToken,
): Request {
  return new Request("https://auth-admin.invalid/", {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

describe("Auth管理用の短命remote Worker", () => {
  beforeEach(() => {
    bootstrapFirstUserMock.mockReset();
    resetPasswordMock.mockReset();
  });

  it.each(["bootstrap", "reset-password"] as const)(
    "%sを認証済みrequest bodyからだけ実行する",
    async (command) => {
      const response = await authAdminPlatform.fetch(adminRequest({
        command,
        email: "person@example.test",
        passwordHash: "pbkdf2-sha256$v1$600000$salt$hash",
      }), env);

      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      const expected = [db, "person@example.test", "pbkdf2-sha256$v1$600000$salt$hash"];
      expect(command === "bootstrap" ? bootstrapFirstUserMock : resetPasswordMock)
        .toHaveBeenCalledWith(...expected);
    },
  );

  it("token不一致ではD1へ触れず、要求値を応答へ含めない", async () => {
    const response = await authAdminPlatform.fetch(adminRequest({
      command: "bootstrap",
      email: "person@example.test",
      passwordHash: "secret-hash",
    }, "wrong-token"), env);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(bootstrapFirstUserMock).not.toHaveBeenCalled();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("D1競合と未知の失敗を本文なしのstatusだけで区別する", async () => {
    bootstrapFirstUserMock
      .mockRejectedValueOnce(new D1ConflictError("existing person@example.test"))
      .mockRejectedValueOnce(new Error("AUTH_SECRET secret-hash"));

    const conflict = await authAdminPlatform.fetch(adminRequest({
      command: "bootstrap",
      email: "person@example.test",
      passwordHash: "pbkdf2-sha256$v1$600000$salt$secret-hash",
    }), env);
    const unknown = await authAdminPlatform.fetch(adminRequest({
      command: "bootstrap",
      email: "person@example.test",
      passwordHash: "pbkdf2-sha256$v1$600000$salt$secret-hash",
    }), env);

    expect(conflict.status).toBe(409);
    expect(await conflict.text()).toBe("");
    expect(unknown.status).toBe(500);
    expect(await unknown.text()).toBe("");
  });
});
