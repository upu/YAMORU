import { unstable_dev } from "wrangler";

export type PreviewE2eFixtures = {
  ownerEmail: string;
  ownerPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
};

type RemoteRequestInit = {
  headers: Record<string, string>;
  method: "POST";
};

type RemoteDevWorker = {
  fetch(input?: string, init?: RemoteRequestInit): Promise<{
    json(): Promise<unknown>;
    status: number;
  }>;
  stop(): Promise<void>;
};

type StartRemoteDev = (
  scriptPath: string,
  options: {
    config: string;
    env: "preview";
    envFiles: string[];
    experimental: {
      disableDevRegistry: boolean;
      disableExperimentalWarning: boolean;
    };
    local: false;
    logLevel: "error";
    vars: { E2E_ADMIN_SESSION_TOKEN: string };
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
      return { json: () => response.json(), status: response.status };
    },
    stop: () => worker.stop(),
  };
}

function createSessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

class PreviewE2eFixtureConnectionError extends Error {
  constructor() {
    super("Preview E2E fixture reset connection failed");
  }
}

class PreviewE2eFixtureDatabaseError extends Error {
  constructor() {
    super("Preview E2E fixture reset database operation failed");
  }
}

function isPreviewE2eFixtures(value: unknown): value is PreviewE2eFixtures {
  if (typeof value !== "object" || value === null) return false;
  const fixtures = value as Record<string, unknown>;
  return (
    typeof fixtures.ownerEmail === "string" &&
    typeof fixtures.ownerPassword === "string" &&
    typeof fixtures.outsiderEmail === "string" &&
    typeof fixtures.outsiderPassword === "string"
  );
}

// preview D1上のE2E固定テストアカウント(owner・outsider)を消してから
// 作り直し、パスワードを含むfixtureをこのプロセス内だけへ返す(#151)。
// auth-admin-remote.tsと同じ「一時Worker + bearer token」方式で、
// CLOUDFLARE_API_TOKEN自体をこのスクリプトへ渡さずpreviewのD1へ書き込む。
export async function resetPreviewE2eFixtures(
  startDev: StartRemoteDev = startWranglerRemoteDev,
): Promise<PreviewE2eFixtures> {
  const sessionToken = createSessionToken();
  let worker: RemoteDevWorker;
  try {
    worker = await startDev("scripts/e2e-admin-platform.ts", {
      config: "config/wrangler/e2e-admin.jsonc",
      env: "preview",
      envFiles: [],
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
      },
      local: false,
      logLevel: "error",
      vars: { E2E_ADMIN_SESSION_TOKEN: sessionToken },
    });
  } catch {
    throw new PreviewE2eFixtureConnectionError();
  }

  try {
    const response = await worker.fetch("http://127.0.0.1/", {
      headers: { authorization: `Bearer ${sessionToken}` },
      method: "POST",
    });
    if (response.status !== 200) throw new PreviewE2eFixtureDatabaseError();
    const body: unknown = await response.json();
    if (!isPreviewE2eFixtures(body)) throw new PreviewE2eFixtureDatabaseError();
    return body;
  } finally {
    try {
      await worker.stop();
    } catch {
      // D1更新後のremote preview停止失敗を操作失敗として誤表示しない。
    }
  }
}
