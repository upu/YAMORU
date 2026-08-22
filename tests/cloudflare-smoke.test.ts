import { describe, expect, it } from "vitest";

import {
  assertSmokeResponse,
  PRODUCTION_SMOKE_CHECKS,
} from "../scripts/cloudflare-smoke-contract";

describe("Cloudflare公開環境の認証境界", () => {
  it("公開資産・招待入口・ログイン画面と保護画面を確認対象にする", () => {
    expect(PRODUCTION_SMOKE_CHECKS.map(({ pathname }) => pathname)).toEqual([
      "/manifest.webmanifest",
      "/icon.png",
      "/invitations/accept",
      "/login",
      "/account",
    ]);
  });

  it("manifestとアイコンは未認証で取得できる", () => {
    expect(() => {
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[0], {
        body: "{}",
        contentType: "application/manifest+json",
        location: null,
        status: 200,
      });
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[1], {
        body: "",
        contentType: "image/png",
        location: null,
        status: 200,
      });
    }).not.toThrow();
  });

  it("招待入口は生tokenを含まない公開HTMLを未認証で返す(#140)", () => {
    expect(() => {
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[2], {
        body: "<h1>招待を確認しています</h1>",
        contentType: "text/html; charset=utf-8",
        location: null,
        status: 200,
      });
    }).not.toThrow();
  });

  it("保護画面はログインへ移動し、ログイン画面は公開する", () => {
    expect(() => {
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[3], {
        body: "<h1>YAMORUへログイン</h1>",
        contentType: "text/html; charset=utf-8",
        location: null,
        status: 200,
      });
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[4], {
        body: "",
        contentType: null,
        location: "https://yamoru.example/login?callbackUrl=%2Faccount",
        status: 307,
      });
    }).not.toThrow();
  });

  it("公開資産のContent-Type違いと保護画面の200を拒否する", () => {
    expect(() => {
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[0], {
        body: "{}",
        contentType: "text/html",
        location: null,
        status: 200,
      });
    }).toThrow(/Content-Type/u);
    expect(() => {
      assertSmokeResponse(PRODUCTION_SMOKE_CHECKS[4], {
        body: "secret page",
        contentType: "text/html",
        location: null,
        status: 200,
      });
    }).toThrow(/login/u);
  });
});
