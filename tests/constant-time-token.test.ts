import { describe, expect, it } from "vitest";

import { constantTimeTokenMatch } from "../src/lib/auth/constant-time-token";

describe("管理用Workerのsession token比較", () => {
  it.each([
    ["temporary-session-token", "temporary-session-token"],
    ["", ""],
    ["家守-session-token-🔐", "家守-session-token-🔐"],
  ])("同じtokenだけを一致として扱う", async (provided, expected) => {
    await expect(constantTimeTokenMatch(provided, expected)).resolves.toBe(true);
  });

  it.each([
    ["temporary-session-token", "temporary-session-tokeN"],
    ["short", "a-much-longer-token"],
    ["家守-session-token-🔐", "家守-session-token-🔑"],
    ["", "non-empty"],
  ])("異なるtokenは文字数や文字種にかかわらず拒否する", async (provided, expected) => {
    await expect(constantTimeTokenMatch(provided, expected)).resolves.toBe(false);
  });
});
