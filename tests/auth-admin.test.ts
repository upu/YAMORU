import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  AUTH_ADMIN_FAILURE_MESSAGE,
  getAuthAdminFailureMessage,
  getLocalAuthAdminPlatformOptions,
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

  it("localコマンドはremote bindingを無効にした専用設定を選ぶ", () => {
    expect(getLocalAuthAdminPlatformOptions()).toEqual({
      configPath: "wrangler.auth-admin.jsonc",
      envFiles: [],
      persist: true,
      remoteBindings: false,
    });
  });

  it("失敗表示へ入力値や内部例外を混ぜない", () => {
    expect(AUTH_ADMIN_FAILURE_MESSAGE).toBe(
      "認証情報を更新できませんでした。入力とD1の状態を確認してください。\n",
    );
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("password");
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("hash");
    expect(AUTH_ADMIN_FAILURE_MESSAGE).not.toContain("secret");
  });

  it.each([
    ["invocation", "bootstrap", "コマンドの指定が正しくありません。環境名入りのnpm scriptを使用してください。\n"],
    ["target-confirmation", "bootstrap", "操作対象の確認が一致しません。プロンプトに表示されたD1名を完全一致で入力してください。\n"],
    ["email", "bootstrap", "メールアドレスの形式が正しくありません。@を含むメールアドレスを入力してください。\n"],
    ["password-length", "bootstrap", "パスワードが短すぎます。12文字以上で入力してください。\n"],
    ["password-confirmation", "bootstrap", "パスワードの1回目と2回目が一致しません。もう一度入力してください。\n"],
    ["input", "bootstrap", "入力を読み取れませんでした。コマンドを再実行してください。\n"],
    ["password-hash", "bootstrap", "パスワードを安全に処理できませんでした。コマンドを再実行してください。\n"],
    ["connection", "bootstrap", "D1への接続を確立できませんでした。Cloudflareへのログイン状態と対象環境を確認してください。\n"],
    ["database", "bootstrap", "bootstrapできませんでした。対象D1に利用者が存在しないこととmigration適用済みであることを確認してください。\n"],
    ["database", "reset-password", "パスワードを再設定できませんでした。対象D1に利用者が存在することとmigration適用済みであることを確認してください。\n"],
  ] as const)("%s失敗を秘密なしで判別できる", (stage, command, expected) => {
    const message = getAuthAdminFailureMessage(stage, command);

    expect(message).toBe(expected);
    expect(message).not.toContain("person@example.test");
    expect(message).not.toContain("plain-password");
    expect(message).not.toContain("password_hash");
    expect(message).not.toContain("AUTH_SECRET");
  });

  it.each([
    {
      args: ["unknown"],
      input: "",
      expected: "コマンドの指定が正しくありません。環境名入りのnpm scriptを使用してください。\n",
    },
    {
      args: ["bootstrap", "--environment", "preview"],
      input: "wrong-target\nperson@example.test\nplain-password\nplain-password\n",
      expected: "操作対象の確認が一致しません。プロンプトに表示されたD1名を完全一致で入力してください。\n",
    },
    {
      args: ["bootstrap", "--environment", "preview"],
      input: "yamoru-preview\ninvalid-email\nlong-password\nlong-password\n",
      expected: "メールアドレスの形式が正しくありません。@を含むメールアドレスを入力してください。\n",
    },
    {
      args: ["bootstrap", "--environment", "preview"],
      input: "yamoru-preview\nperson@example.test\nshort\nshort\n",
      expected: "パスワードが短すぎます。12文字以上で入力してください。\n",
    },
    {
      args: ["bootstrap", "--environment", "preview"],
      input: "yamoru-preview\nperson@example.test\nlong-password-1\nlong-password-2\n",
      expected: "パスワードの1回目と2回目が一致しません。もう一度入力してください。\n",
    },
  ])("CLIが失敗段階だけを表示する: $args", ({ args, input, expected }) => {
    const result = spawnSync(process.execPath, ["scripts/auth-admin.ts", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      input,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(expected);
    expect(result.stderr).not.toContain("person@example.test");
    expect(result.stderr).not.toContain("plain-password");
  });
});
