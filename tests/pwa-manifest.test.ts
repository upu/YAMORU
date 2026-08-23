import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata, viewport } from "../app/layout";
import manifest from "../app/manifest";
import { authMiddlewareConfig as middlewareConfig } from "../auth.config";

function readPng(path: string) {
  const png = readFileSync(join(process.cwd(), path));

  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return png;
}

function expectPngSize(path: string, width: number, height: number) {
  const png = readPng(path);

  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
}

function expectOpaqueRgbPng(path: string) {
  // PNGのIHDR color type 2はalpha channelを持たないtruecolor RGB。
  expect(readPng(path)[25]).toBe(2);
}

function isHandledByAuthMiddleware(pathname: string) {
  return new RegExp(`^${middlewareConfig.matcher[0]}$`, "u").test(pathname);
}

describe("PWA manifest", () => {
  it("ホーム画面からYAMORUのルートを独立表示で起動する", () => {
    expect(manifest()).toMatchObject({
      name: "YAMORU",
      short_name: "YAMORU",
      description: "暮らしの「いつだっけ？」をなくす。",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f4f2eb",
      theme_color: "#315c49",
    });
  });

  it("Androidのホーム画面追加に必要なPNGアイコンを公開する", () => {
    expect(manifest().icons).toEqual(
      expect.arrayContaining([
        {
          src: "/pwa/yamoru-icon-v3-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa/yamoru-icon-v3-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ]),
    );

    expectPngSize("public/pwa/yamoru-icon-v3-192x192.png", 192, 192);
    expectPngSize("public/pwa/yamoru-icon-v3-512x512.png", 512, 512);
  });
});

describe("PWA metadata", () => {
  it("Next.jsのファイル規約で一般用とApple用のアイコンを公開する", () => {
    expect(existsSync(join(process.cwd(), "app/icon.png"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/apple-icon.png"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/manifest.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/manifest.webmanifest/route.ts"))).toBe(false);
    expect(metadata.icons).toBeUndefined();
    expect(metadata.manifest).toBeUndefined();

    expectPngSize("app/icon.png", 512, 512);
    expectPngSize("app/apple-icon.png", 180, 180);
    expectOpaqueRgbPng("app/apple-icon.png");
  });

  it("iOSのホーム画面からYAMORUとして独立表示で起動する", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      startupImage: [
        {
          media:
            "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
          url: "/pwa/yamoru-startup-iphone-16-portrait.png",
        },
      ],
      title: "YAMORU",
      statusBarStyle: "default",
    });
    expect(metadata.other).toMatchObject({
      "apple-mobile-web-app-capable": "yes",
    });
    expect(metadata.icons).toBeUndefined();
    expect(metadata.manifest).toBeUndefined();
  });

  it("iPhone 16縦向きの不透明な起動画面を公開する", () => {
    const startupImagePath = "public/pwa/yamoru-startup-iphone-16-portrait.png";

    expectPngSize(startupImagePath, 1179, 2556);
    expectOpaqueRgbPng(startupImagePath);
    expect(isHandledByAuthMiddleware("/pwa/yamoru-startup-iphone-16-portrait.png")).toBe(
      false,
    );
  });

  it("未認証でもmanifestと標準Appleアイコンを取得できる", () => {
    expect(isHandledByAuthMiddleware("/manifest.webmanifest")).toBe(false);
    expect(isHandledByAuthMiddleware("/account")).toBe(true);

    const iconPaths = [
      "public/apple-touch-icon.png",
      "public/apple-touch-icon-precomposed.png",
    ];
    iconPaths.forEach((path) => {
      expectPngSize(path, 180, 180);
      expectOpaqueRgbPng(path);
    });
    expect(readPng(iconPaths[1])).toEqual(readPng(iconPaths[0]));
  });

  it("ブラウザのテーマ色をmanifestと揃える", () => {
    expect(viewport.themeColor).toBe("#315c49");
  });
});
