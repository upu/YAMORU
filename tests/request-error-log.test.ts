import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "../instrumentation";
import {
  buildRequestErrorLog,
  formatRequestErrorLog,
  type RequestErrorContext,
} from "../lib/observability/request-error";

const CONTEXT: RequestErrorContext = {
  renderSource: "react-server-components",
  routePath: "/household",
  routeType: "render",
  routerKind: "App Router",
};

// 実際のNext.jsは、cookieを含むヘッダーとquery付きのpathも渡してくる。
const REQUEST = {
  headers: { cookie: "__Secure-authjs.session-token=secret-jwt" },
  method: "GET",
  path: "/invitations/accept?claim=secret-claim",
};

function captureConsoleError(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    if (typeof line === "string") lines.push(line);
  });
  return lines;
}

describe("サーバ例外の構造化ログ", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("例外の種別とメッセージ、発生した経路を記録する", () => {
    const error = Object.assign(new Error("D1_ERROR: Network connection lost."), {
      digest: "1234567890",
    });

    expect(buildRequestErrorLog(error, CONTEXT)).toEqual({
      digest: "1234567890",
      event: "yamoru.request_error",
      message: "D1_ERROR: Network connection lost.",
      name: "Error",
      renderSource: "react-server-components",
      routePath: "/household",
      routeType: "render",
      routerKind: "App Router",
    });
  });

  it("digestとrenderSourceがなくてもJSONの形を変えない", () => {
    const log = buildRequestErrorLog(new Error("boom"), {
      routePath: "/todos/new",
      routeType: "action",
      routerKind: "App Router",
    });

    expect(log.digest).toBeNull();
    expect(log.renderSource).toBeNull();
    expect(Object.keys(log).sort()).toEqual([
      "digest",
      "event",
      "message",
      "name",
      "renderSource",
      "routePath",
      "routeType",
      "routerKind",
    ]);
  });

  it("Error以外が投げられても記録を落とさない", () => {
    expect(buildRequestErrorLog("壊れました", CONTEXT)).toMatchObject({
      message: "壊れました",
      name: "string",
    });
    expect(buildRequestErrorLog({ code: 7500 }, CONTEXT)).toMatchObject({
      message: "",
      name: "object",
    });
  });

  it("長すぎるメッセージは打ち切る", () => {
    const log = buildRequestErrorLog(new Error("あ".repeat(900)), CONTEXT);

    expect(log.message).toHaveLength(501);
    expect(log.message.endsWith("…")).toBe(true);
  });

  it("要求のpathとヘッダーを記録しない", () => {
    const lines = captureConsoleError();

    onRequestError(new Error("boom"), REQUEST, CONTEXT);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret-jwt");
    expect(lines[0]).not.toContain("secret-claim");
    expect(lines[0]).not.toContain("cookie");
  });

  it("onRequestErrorは1行のJSONとしてconsole.errorへ出す", () => {
    const lines = captureConsoleError();
    const error = new Error("boom");

    onRequestError(error, REQUEST, CONTEXT);

    expect(lines).toEqual([formatRequestErrorLog(error, CONTEXT)]);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toContain('"event":"yamoru.request_error"');
  });
});
