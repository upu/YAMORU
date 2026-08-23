import { describe, expect, it, vi } from "vitest";

vi.mock("wrangler", () => ({ unstable_dev: vi.fn() }));

import {
  RemoteAuthAdminConnectionError,
  RemoteAuthAdminDatabaseError,
  runRemoteAuthAdmin,
} from "../scripts/auth-admin-remote";

type TestRequestInit = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
};

type TestStartDevOptions = {
  config: string;
  env: "preview" | "production";
  envFiles: string[];
  local: false;
  logLevel: "error";
  vars: { AUTH_ADMIN_SESSION_TOKEN: string };
};

type TestRemoteWorker = {
  fetch(input?: string, init?: TestRequestInit): Promise<Response>;
  stop(): Promise<void>;
};

type TestStartDev = (
  scriptPath: string,
  options: TestStartDevOptions,
) => Promise<TestRemoteWorker>;

function createRemoteDev(response: Response) {
  const fetchMock = vi.fn<TestRemoteWorker["fetch"]>((input, init) => {
    void input;
    void init;
    return Promise.resolve(response);
  });
  const stopMock = vi.fn<TestRemoteWorker["stop"]>(() => Promise.resolve());
  const startDevMock = vi.fn<TestStartDev>((scriptPath, options) => {
    void scriptPath;
    void options;
    return Promise.resolve({
      fetch: fetchMock,
      stop: stopMock,
    });
  });
  return {
    fetchMock,
    startDevMock,
    stopMock,
  };
}

describe("remote Auth管理接続", () => {
  it.each(["preview", "production"] as const)(
    "%sは短命remote Workerのrequest bodyだけへ認証情報を渡す",
    async (environment) => {
      const { fetchMock, startDevMock, stopMock } = createRemoteDev(
        new Response(null, { status: 204 }),
      );

      await runRemoteAuthAdmin({
        command: "bootstrap",
        email: "person@example.test",
        environment,
        passwordHash: "secret-hash",
      }, startDevMock);

      const startCall = startDevMock.mock.calls[0];
      const options = startCall[1];
      expect(startCall[0]).toBe("scripts/auth-admin-platform.ts");
      expect(options.config).toBe("config/wrangler/auth-admin.jsonc");
      expect(options.env).toBe(environment);
      expect(options.envFiles).toEqual([]);
      expect(options.local).toBe(false);
      expect(options.logLevel).toBe("error");
      expect(typeof options.vars.AUTH_ADMIN_SESSION_TOKEN).toBe("string");
      expect(JSON.stringify(options)).not.toContain("person@example.test");
      expect(JSON.stringify(options)).not.toContain("secret-hash");
      const sessionToken = options.vars.AUTH_ADMIN_SESSION_TOKEN;
      expect(sessionToken).not.toBe("");

      const fetchCall = fetchMock.mock.calls[0];
      const requestInit = fetchCall[1];
      expect(requestInit).toBeDefined();
      if (requestInit === undefined) throw new Error("request init was missing");
      expect(JSON.parse(requestInit.body)).toEqual({
        command: "bootstrap",
        email: "person@example.test",
        passwordHash: "secret-hash",
      });
      expect(new Headers(requestInit.headers).get("authorization"))
        .toBe(`Bearer ${sessionToken}`);
      expect(stopMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [409, RemoteAuthAdminDatabaseError],
    [500, RemoteAuthAdminDatabaseError],
    [401, RemoteAuthAdminConnectionError],
  ] as const)("remote Workerのstatus %sを安全な失敗分類へ変換する", async (status, ErrorType) => {
    const { startDevMock, stopMock } = createRemoteDev(
      new Response("must-not-be-forwarded", { status }),
    );

    await expect(runRemoteAuthAdmin({
      command: "reset-password",
      email: "person@example.test",
      environment: "preview",
      passwordHash: "secret-hash",
    }, startDevMock)).rejects.toBeInstanceOf(ErrorType);
    expect(stopMock).toHaveBeenCalledOnce();
  });
});
