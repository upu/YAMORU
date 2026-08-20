import { describe, expect, it } from "vitest";

import { parseAuthAdminCommand } from "../lib/auth/admin-command";

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
});
