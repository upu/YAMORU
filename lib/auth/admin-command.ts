export type AuthAdminCommand = "bootstrap" | "reset-password";

export type AuthAdminEnvironment = "local" | "preview" | "production";

export type AuthAdminInvocation = {
  command: AuthAdminCommand;
  environment: AuthAdminEnvironment;
};

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
