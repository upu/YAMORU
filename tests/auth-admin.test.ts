import { describe, expect, it } from "vitest";

import {
  AUTH_ADMIN_FAILURE_MESSAGE,
  getAuthAdminPlatformOptions,
  parseAuthAdminCommand,
  parseAuthAdminInvocation,
} from "../lib/auth/admin-command";

describe("auth admin command boundary", () => {
  it.each(["bootstrap", "reset-password"] as const)("%sだけをサブコマンドとして受け付ける", (command) => {
    expect(parseAuthAdminCommand([command])).toBe(command);
  });

  it.each([
    [[]],
    [["unknown"]],
    [["bootstrap", "person@example.test"]],
    [["reset-password", "person@example.test", "plain-password"]],
  ])("メールやパスワードをCLI引数として受け付けない: %j", (args) => {
    expect(() => parseAuthAdminCommand(args)).toThrow();
  });

  it("既存コマンドはlocal D1だけを対象にする", () => {
    expect(parseAuthAdminInvocation(["bootstrap"])).toEqual({
      command: "bootstrap",
      environment: "local",
    });
  });

  it.each(["preview", "production"] as const)(
    "%s D1は明示したWrangler環境だけを対象にする",
    (environment) => {
      expect(
        parseAuthAdminInvocation(["reset-password", "--environment", environment]),
      ).toEqual({ command: "reset-password", environment });
    },
  );

  it.each([
    ["bootstrap", "--environment", "local"],
    ["bootstrap", "--environment", "prod"],
    ["bootstrap", "--environment", "production", "secret"],
  ])("曖昧または余分なremote指定を拒否する: %j", (...args) => {
    expect(() => parseAuthAdminInvocation(args)).toThrow();
  });

  it.each([
    ["bootstrap", "local"],
    ["reset-password", "local"],
    ["bootstrap", "preview"],
    ["reset-password", "preview"],
    ["bootstrap", "production"],
    ["reset-password", "production"],
  ] as const)("%sは%s専用の接続設定を選ぶ", (command, environment) => {
    const args = environment === "local"
      ? [command]
      : [command, "--environment", environment];
    const invocation = parseAuthAdminInvocation(args);

    expect(getAuthAdminPlatformOptions(invocation.environment)).toEqual(
      environment === "local"
        ? {
            configPath: "wrangler.auth-admin.jsonc",
            envFiles: [],
            persist: true,
            remoteBindings: false,
          }
        : {
            configPath: "wrangler.auth-admin.jsonc",
            environment,
            envFiles: [],
            persist: false,
            remoteBindings: true,
          },
    );
  });

  it("失敗表示へ入力値や内部例外を混ぜない", () => {
    expect(AUTH_ADMIN_FAILURE_MESSAGE).toBe(
      "認証情報を更新できませんでした。入力とD1の状態を確認してください。\n",
    );
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("password");
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("hash");
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("secret");
  });
});
