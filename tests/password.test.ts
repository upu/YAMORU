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

  it("Cloudflare Workersのcrypto.subtle/node:crypto pbkdf2が受け付ける上限(100,000回)を超えない", () => {
    // Issue #142: crypto.subtle.deriveBits()とnode:crypto pbkdf2()はどちらも
    // Cloudflare Workers上で反復回数100,000回を超えると例外になる。
    // この上限を超えるとローカルのテストは通ってもWorkers上のログインが壊れるため、
    // 定数そのものを固定する。
    expect(PASSWORD_HASH_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it("上限より大きい反復回数を記録したhash(移行前の600,000回など)は検証時に安全に拒否する", async () => {
    const passwordHash = await hashPassword("right-password-value");
    const overLimitHash = passwordHash.replace(
      `$${String(PASSWORD_HASH_ITERATIONS)}$`,
      `$${String(PASSWORD_HASH_ITERATIONS + 1)}$`,
    );

    await expect(verifyPassword("right-password-value", overLimitHash)).resolves.toBe(false);
  });
});
