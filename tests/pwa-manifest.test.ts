import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata, viewport } from "../app/layout";
import manifest from "../app/manifest";

function expectPngSize(path: string, width: number, height: number) {
  const png = readFileSync(join(process.cwd(), path));

  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
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

  it("ブラウザのテーマ色をmanifestと揃える", () => {
    expect(viewport.themeColor).toBe("#315c49");
  });
});
