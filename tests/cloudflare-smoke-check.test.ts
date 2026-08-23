import { describe, expect, it, vi } from "vitest";

import { PRODUCTION_SMOKE_CHECKS } from "../scripts/cloudflare-smoke-contract";
import {
  runSmokeCheckWithRetry,
  type SmokeCheckRetryFailure,
} from "../scripts/cloudflare-smoke-check";

const LOGIN_CHECK = PRODUCTION_SMOKE_CHECKS[3]; // /login (public, text/html)
const ACCOUNT_CHECK = PRODUCTION_SMOKE_CHECKS[4]; // /account (redirect → /login)

const POLICY = { delaysMs: [0, 0, 0], maxAttempts: 4 };

describe("公開境界checkの上限付き再試行(#152)", () => {
  it("初回成功時は1回だけfetchし、待機やretry通知は発生しない", async () => {
    const fetchResponse = vi.fn(() => Promise.resolve({
      body: "<h1>YAMORUへログイン</h1>",
      contentType: "text/html; charset=utf-8",
      location: null,
      status: 200,
    }));
    const onRetry = vi.fn<(failure: SmokeCheckRetryFailure) => void>();

    await runSmokeCheckWithRetry(LOGIN_CHECK, fetchResponse, POLICY, { onRetry });

    expect(fetchResponse).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("デプロイ直後の一時的な303応答の後に200へ切り替わるケースは成功する(#152の実例)", async () => {
    let attempts = 0;
    const fetchResponse = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({
          body: "",
          contentType: null,
          location: "https://yamoru.example/",
          status: 303,
        });
      }
      return Promise.resolve({
        body: "<h1>招待を確認しています</h1>",
        contentType: "text/html; charset=utf-8",
        location: null,
        status: 200,
      });
    });
    const onRetry = vi.fn<(failure: SmokeCheckRetryFailure) => void>();

    await runSmokeCheckWithRetry(
      PRODUCTION_SMOKE_CHECKS[2], // /invitations/accept
      fetchResponse,
      POLICY,
      { onRetry },
    );

    expect(fetchResponse).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    const [failure] = onRetry.mock.calls[0];
    expect(failure.attempt).toBe(1);
    expect(failure.maxAttempts).toBe(4);
    expect(failure.pathname).toBe("/invitations/accept");
    expect(failure.reason).toMatch(/200ではなく303/u);
  });

  it("上限まで異常が継続するケースは、pathname・最終status・期待条件を含めて非0終了させる", async () => {
    const fetchResponse = vi.fn(() => Promise.resolve({
      body: "secret page",
      contentType: "text/html",
      location: null,
      status: 200,
    }));
    const onRetry = vi.fn<(failure: SmokeCheckRetryFailure) => void>();

    await expect(
      runSmokeCheckWithRetry(ACCOUNT_CHECK, fetchResponse, POLICY, { onRetry }),
    ).rejects.toThrow(
      /\/account[\s\S]*4回試行[\s\S]*最終status: 200[\s\S]*\/loginへのredirect/u,
    );

    expect(fetchResponse).toHaveBeenCalledTimes(POLICY.maxAttempts);
    expect(onRetry).toHaveBeenCalledTimes(POLICY.maxAttempts - 1);
  });

  it("接続失敗(fetch自体の例外)も再試行対象になり、最終失敗時はstatusを「取得不可」と報告する", async () => {
    const fetchResponse = vi.fn(() => Promise.reject(new Error("fetch failed")));

    await expect(
      runSmokeCheckWithRetry(LOGIN_CHECK, fetchResponse, POLICY),
    ).rejects.toThrow(/最終status: 取得不可/u);

    expect(fetchResponse).toHaveBeenCalledTimes(POLICY.maxAttempts);
  });

  it("失敗メッセージにresponse bodyやqueryを含めない", async () => {
    const fetchResponse = vi.fn(() => Promise.resolve({
      body: "<script>alert(document.cookie)</script>秘密のトークンxyz",
      contentType: "text/html",
      location: null,
      status: 200,
    }));

    const rejection = await runSmokeCheckWithRetry(
      ACCOUNT_CHECK,
      fetchResponse,
      POLICY,
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).not.toContain("秘密のトークン");
    expect((rejection as Error).message).not.toContain("<script>");
  });
});
