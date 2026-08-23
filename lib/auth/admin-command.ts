import { MIN_PASSWORD_LENGTH } from "./password-policy.ts";

export type AuthAdminCommand = "bootstrap" | "reset-password";

export type AuthAdminEnvironment = "local" | "preview" | "production";

export type AuthAdminInvocation = {
  command: AuthAdminCommand;
  environment: AuthAdminEnvironment;
};

export type AuthAdminFailureStage =
  | "invocation"
  | "target-confirmation"
  | "email"
  | "password-length"
  | "password-confirmation"
  | "input"
  | "password-hash"
  | "connection"
  | "database";

export const AUTH_ADMIN_FAILURE_MESSAGE =
  "認証情報を更新できませんでした。入力とD1の状態を確認してください。\n";

export function getAuthAdminFailureMessage(
  stage: AuthAdminFailureStage,
  command: AuthAdminCommand,
): string {
  switch (stage) {
    case "invocation":
      return "コマンドの指定が正しくありません。環境名入りのnpm scriptを使用してください。\n";
    case "target-confirmation":
      return "操作対象の確認が一致しません。プロンプトに表示されたD1名を完全一致で入力してください。\n";
    case "email":
      return "メールアドレスの形式が正しくありません。@を含むメールアドレスを入力してください。\n";
    case "password-length":
      return `パスワードが短すぎます。${String(MIN_PASSWORD_LENGTH)}文字以上で入力してください。\n`;
    case "password-confirmation":
      return "パスワードの1回目と2回目が一致しません。もう一度入力してください。\n";
    case "input":
      return "入力を読み取れませんでした。コマンドを再実行してください。\n";
    case "password-hash":
      return "パスワードを安全に処理できませんでした。コマンドを再実行してください。\n";
    case "connection":
      return "D1への接続を確立できませんでした。Cloudflareへのログイン状態と対象環境を確認してください。\n";
    case "database":
      return command === "bootstrap"
        ? "bootstrapできませんでした。対象D1に利用者が存在しないこととmigration適用済みであることを確認してください。\n"
        : "パスワードを再設定できませんでした。対象D1に利用者が存在することとmigration適用済みであることを確認してください。\n";
  }
}

export function getLocalAuthAdminPlatformOptions(): {
  configPath: string;
  envFiles: string[];
  persist: boolean;
  remoteBindings: boolean;
} {
  return {
    configPath: "config/wrangler/auth-admin.jsonc",
    envFiles: [],
    persist: true,
    remoteBindings: false,
  };
}

export function parseAuthAdminCommand(args: string[]): AuthAdminCommand {
  if (args.length !== 1 || (args[0] !== "bootstrap" && args[0] !== "reset-password")) {
    throw new Error("Usage: auth-admin <bootstrap|reset-password>");
  }
  return args[0];
}

export function parseAuthAdminInvocation(args: string[]): AuthAdminInvocation {
  if (args.length === 1) {
    return { command: parseAuthAdminCommand(args), environment: "local" };
  }
  if (
    args.length !== 3 ||
    args[1] !== "--environment" ||
    (args[2] !== "preview" && args[2] !== "production")
  ) {
    throw new Error(
      "Usage: auth-admin <bootstrap|reset-password> [--environment <preview|production>]",
    );
  }
  return {
    command: parseAuthAdminCommand([args[0] ?? ""]),
    environment: args[2],
  };
}
