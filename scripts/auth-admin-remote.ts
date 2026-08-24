import { unstable_dev } from "wrangler";

import type {
  AuthAdminCommand,
  AuthAdminEnvironment,
} from "../src/lib/auth/admin-command.ts";

type RemoteAuthAdminEnvironment = Exclude<AuthAdminEnvironment, "local">;

type RemoteAuthAdminInput = {
  command: AuthAdminCommand;
  email: string;
  environment: RemoteAuthAdminEnvironment;
  passwordHash: string;
};

type RemoteRequestInit = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
};

type RemoteDevWorker = {
  fetch(input?: string, init?: RemoteRequestInit): Promise<{ status: number }>;
  stop(): Promise<void>;
};

type StartRemoteDev = (
  scriptPath: string,
  options: {
    config: string;
    env: RemoteAuthAdminEnvironment;
    envFiles: string[];
    experimental: {
      disableDevRegistry: boolean;
      disableExperimentalWarning: boolean;
    };
    local: false;
    logLevel: "error";
    vars: { AUTH_ADMIN_SESSION_TOKEN: string };
  },
) => Promise<RemoteDevWorker>;

async function startWranglerRemoteDev(
  scriptPath: string,
  options: Parameters<StartRemoteDev>[1],
): Promise<RemoteDevWorker> {
  const worker = await unstable_dev(scriptPath, options);
  return {
    async fetch(input, init) {
      const response = await worker.fetch(input, init);
      return { status: response.status };
    },
    stop: () => worker.stop(),
  };
}

function createSessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

export class RemoteAuthAdminDatabaseError extends Error {
  constructor() {
    super("Remote Auth admin database operation failed");
  }
}

export class RemoteAuthAdminConnectionError extends Error {
  constructor() {
    super("Remote Auth admin connection failed");
  }
}

export async function runRemoteAuthAdmin(
  input: RemoteAuthAdminInput,
  startDev: StartRemoteDev = startWranglerRemoteDev,
): Promise<void> {
  const sessionToken = createSessionToken();
  let worker: RemoteDevWorker;
  try {
    worker = await startDev("scripts/auth-admin-platform.ts", {
      config: "config/wrangler/auth-admin.jsonc",
      env: input.environment,
      envFiles: [],
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
      },
      local: false,
      logLevel: "error",
      vars: { AUTH_ADMIN_SESSION_TOKEN: sessionToken },
    });
  } catch {
    throw new RemoteAuthAdminConnectionError();
  }

  try {
    const response = await worker.fetch("http://127.0.0.1/", {
      body: JSON.stringify({
        command: input.command,
        email: input.email,
        passwordHash: input.passwordHash,
      }),
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (response.status === 204) return;
    if (response.status === 409 || response.status === 500) {
      throw new RemoteAuthAdminDatabaseError();
    }
    throw new RemoteAuthAdminConnectionError();
  } finally {
    try {
      await worker.stop();
    } catch {
      // D1更新後のremote preview停止失敗を操作失敗として誤表示しない。
    }
  }
}
