import { describe, expect, it } from "vitest";

import {
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
});
