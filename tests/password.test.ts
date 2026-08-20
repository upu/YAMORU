import { describe, expect, it } from "vitest";

import {
  PASSWORD_HASH_ITERATIONS,
  hashPassword,
  verifyPassword,
} from "../lib/auth/password";

describe("password hashing", () => {
  it("PBKDF2-SHA-256のversioned形式で平文を含まないhashを作る", async () => {
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(
      new RegExp(`^pbkdf2-sha256\\$v1\\$${String(PASSWORD_HASH_ITERATIONS)}\\$[^$]+\\$[^$]+$`),
    );
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
  });

  it("同じパスワードでもsaltが異なるhashを作る", async () => {
    const first = await hashPassword("same-password-value");
    const second = await hashPassword("same-password-value");

    expect(first).not.toBe(second);
  });

  it("誤ったパスワードと壊れたhashを安全に拒否する", async () => {
    const passwordHash = await hashPassword("right-password-value");

    await expect(verifyPassword("wrong-password-value", passwordHash)).resolves.toBe(false);
    await expect(verifyPassword("right-password-value", "not-a-password-hash")).resolves.toBe(false);
  });
});
