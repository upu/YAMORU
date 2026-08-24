import { describe, expect, it } from "vitest";

import { isSafeExternalUrl } from "../src/app/managed-items/model";

describe("管理対象の外部リンク", () => {
  it("httpとhttpsの絶対URLだけを安全なリンクとして扱う", () => {
    expect(isSafeExternalUrl("https://example.com/manual")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/product")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("/manual")).toBe(false);
  });
});
