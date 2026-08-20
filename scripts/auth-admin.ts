import { createInterface } from "node:readline/promises";

import { getPlatformProxy } from "wrangler";

import { parseAuthAdminCommand } from "../lib/auth/admin-command";
import { hashPassword } from "../lib/auth/password";
import { MIN_PASSWORD_LENGTH } from "../lib/auth/password-policy";
import { bootstrapFirstUser, resetPassword } from "../lib/d1/authentication";

type AdminInput = { email: string; password: string };

async function readPipedInput(): Promise<AdminInput> {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  const [email = "", password = "", confirmation = ""] = input.split(/\r?\n/u);
  if (password !== confirmation) throw new Error("Password confirmation does not match");
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

async function readInteractiveInput(): Promise<AdminInput> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const email = await prompt.question("Email: ");
  prompt.close();
  const password = await readHiddenLine("Password: ");
  const confirmation = await readHiddenLine("Password (again): ");
  if (password !== confirmation) throw new Error("Password confirmation does not match");
  return { email, password };
}

async function main(): Promise<void> {
  const command = parseAuthAdminCommand(process.argv.slice(2));
  const input = process.stdin.isTTY ? await readInteractiveInput() : await readPipedInput();
  if (!input.email.includes("@") || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Email and a password of at least ${String(MIN_PASSWORD_LENGTH)} characters are required`);
  }
  const passwordHash = await hashPassword(input.password);
  const platform = await getPlatformProxy<CloudflareEnv>({
    configPath: "wrangler.jsonc",
    persist: true,
    remoteBindings: false,
  });
  try {
    if (command === "bootstrap") {
      await bootstrapFirstUser(platform.env.DB, input.email, passwordHash);
    } else {
      await resetPassword(platform.env.DB, input.email, passwordHash);
    }
  } finally {
    await platform.dispose();
  }
  process.stdout.write("認証情報を更新しました。\n");
}

try {
  await main();
} catch {
  process.stderr.write("認証情報を更新できませんでした。入力とD1の状態を確認してください。\n");
  process.exitCode = 1;
}
