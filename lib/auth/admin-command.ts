export type AuthAdminCommand = "bootstrap" | "reset-password";

export function parseAuthAdminCommand(args: string[]): AuthAdminCommand {
  if (args.length !== 1 || (args[0] !== "bootstrap" && args[0] !== "reset-password")) {
    throw new Error("Usage: auth-admin <bootstrap|reset-password>");
  }
  return args[0];
}
