import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata, viewport } from "../app/layout";
import manifest from "../app/manifest";
import { config as proxyConfig } from "../proxy";

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

function isHandledByAuthProxy(pathname: string) {
  return new RegExp(`^${proxyConfig.matcher[0]}$`, "u").test(pathname);
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
          src: "/pwa/icon-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa/icon-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ]),
    );

    expectPngSize("public/pwa/icon-192x192.png", 192, 192);
    expectPngSize("public/pwa/icon-512x512.png", 512, 512);
  });
});

describe("PWA metadata", () => {
  it("iOSのホーム画面からYAMORUとして独立表示で起動する", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: "YAMORU",
      statusBarStyle: "default",
    });
    expect(metadata.other).toMatchObject({
      "apple-mobile-web-app-capable": "yes",
    });

    expectPngSize("app/apple-icon.png", 180, 180);
  });

  it("未認証でもmanifestと標準Appleアイコンを取得できる", () => {
    expect(isHandledByAuthProxy("/manifest.webmanifest")).toBe(false);
    expect(isHandledByAuthProxy("/account")).toBe(true);

    const iconPaths = [
      "app/apple-icon.png",
      "public/apple-touch-icon.png",
      "public/apple-touch-icon-precomposed.png",
    ];
    iconPaths.forEach((path) => {
      expectPngSize(path, 180, 180);
      expectOpaqueRgbPng(path);
    });
    expect(readPng(iconPaths[1])).toEqual(readPng(iconPaths[0]));
    expect(readPng(iconPaths[2])).toEqual(readPng(iconPaths[0]));
  });

  it("ブラウザのテーマ色をmanifestと揃える", () => {
    expect(viewport.themeColor).toBe("#315c49");
  });
});
