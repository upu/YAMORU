import { createInterface } from "node:readline/promises";

import { getPlatformProxy } from "wrangler";

import {
  AUTH_ADMIN_FAILURE_MESSAGE,
  type AuthAdminCommand,
  type AuthAdminFailureStage,
  getAuthAdminFailureMessage,
  getLocalAuthAdminPlatformOptions,
  parseAuthAdminInvocation,
} from "../lib/auth/admin-command.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { MIN_PASSWORD_LENGTH } from "../lib/auth/password-policy.ts";
import { bootstrapFirstUser, resetPassword } from "../lib/d1/authentication.ts";
import {
  RemoteAuthAdminDatabaseError,
  runRemoteAuthAdmin,
} from "./auth-admin-remote.ts";
import { assertRemoteTargetConfirmation } from "./cloudflare-target.ts";

type AdminInput = { email: string; password: string };

class AuthAdminInputError extends Error {
  readonly stage: Extract<
    AuthAdminFailureStage,
    "target-confirmation" | "password-confirmation"
  >;

  constructor(
    stage: AuthAdminInputError["stage"],
    cause?: unknown,
  ) {
    super("Auth admin input failed", { cause });
    this.stage = stage;
  }
}

class AuthAdminOperationError extends Error {
  readonly stage: AuthAdminFailureStage;
  readonly command: AuthAdminCommand;

  constructor(
    stage: AuthAdminFailureStage,
    command: AuthAdminCommand,
    cause?: unknown,
  ) {
    super("Auth admin operation failed", { cause });
    this.stage = stage;
    this.command = command;
  }
}

async function runStage<T>(
  stage: AuthAdminFailureStage,
  command: AuthAdminCommand,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof AuthAdminInputError) {
      throw new AuthAdminOperationError(cause.stage, command, cause);
    }
    throw new AuthAdminOperationError(stage, command, cause);
  }
}

function assertTargetConfirmation(
  environment: "preview" | "production",
  confirmation: string,
): void {
  try {
    assertRemoteTargetConfirmation(environment, confirmation);
  } catch (cause) {
    throw new AuthAdminInputError("target-confirmation", cause);
  }
}

function assertPasswordConfirmation(
  password: string,
  confirmation: string,
): void {
  if (password !== confirmation) {
    throw new AuthAdminInputError("password-confirmation");
  }
}

async function readPipedInput(
  environment: "local" | "preview" | "production",
): Promise<AdminInput> {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  const lines = input.split(/\r?\n/u);
  if (environment !== "local") {
    assertTargetConfirmation(environment, lines.shift() ?? "");
  }
  const [email = "", password = "", confirmation = ""] = lines;
  assertPasswordConfirmation(password, confirmation);
  return { email, password };
}

async function readHiddenLine(label: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Interactive password input requires a TTY");
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error === undefined) resolve(value);
      else reject(error);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\b" || character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readInteractiveInput(
  environment: "local" | "preview" | "production",
): Promise<AdminInput> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let email: string;
  try {
    if (environment !== "local") {
      const target = `yamoru-${environment}`;
      const confirmation = await prompt.question(
        `操作対象の確認として ${target} を入力: `,
      );
      assertTargetConfirmation(environment, confirmation);
    }
    email = await prompt.question("Email: ");
  } finally {
    prompt.close();
  }
  const password = await readHiddenLine("Password: ");
  const confirmation = await readHiddenLine("Password (again): ");
  assertPasswordConfirmation(password, confirmation);
  return { email, password };
}

async function executeRemoteOperation(
  command: AuthAdminCommand,
  environment: "preview" | "production",
  input: AdminInput,
  passwordHash: string,
): Promise<void> {
  try {
    await runRemoteAuthAdmin({
      command,
      email: input.email,
      environment,
      passwordHash,
    });
  } catch (cause) {
    throw new AuthAdminOperationError(
      cause instanceof RemoteAuthAdminDatabaseError ? "database" : "connection",
      command,
      cause,
    );
  }
}

async function main(): Promise<void> {
  let invocation;
  try {
    invocation = parseAuthAdminInvocation(process.argv.slice(2));
  } catch (cause) {
    throw new AuthAdminOperationError("invocation", "bootstrap", cause);
  }
  const { command, environment } = invocation;
  const input = await runStage("input", command, () => process.stdin.isTTY
    ? readInteractiveInput(environment)
    : readPipedInput(environment));
  if (!input.email.includes("@")) throw new AuthAdminOperationError("email", command);
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthAdminOperationError("password-length", command);
  }
  const passwordHash = await runStage("password-hash", command, () =>
    hashPassword(input.password),
  );
  if (environment !== "local") {
    await executeRemoteOperation(command, environment, input, passwordHash);
    process.stdout.write("認証情報を更新しました。\n");
    return;
  }
  const platform = await runStage("connection", command, () =>
    getPlatformProxy<CloudflareEnv>(getLocalAuthAdminPlatformOptions()),
  );
  try {
    if (command === "bootstrap") {
      await runStage("database", command, () =>
        bootstrapFirstUser(platform.env.DB, input.email, passwordHash),
      );
    } else {
      await runStage("database", command, () =>
        resetPassword(platform.env.DB, input.email, passwordHash),
      );
    }
  } finally {
    try {
      await platform.dispose();
    } catch {
      // D1更新後のcleanup失敗を操作失敗として誤表示しない。
    }
  }
  process.stdout.write("認証情報を更新しました。\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof AuthAdminOperationError
      ? getAuthAdminFailureMessage(error.stage, error.command)
      : AUTH_ADMIN_FAILURE_MESSAGE,
  );
  process.exitCode = 1;
}
