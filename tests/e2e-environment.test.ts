import { describe, expect, it } from "vitest";

import {
  assertE2EWranglerEnvironment,
  E2E_WRANGLER_ENVIRONMENT,
} from "../scripts/e2e-environment";

describe("E2E接続先ガード", () => {
  it("専用のWrangler e2e環境だけを許可する", () => {
    expect(() => { assertE2EWranglerEnvironment(E2E_WRANGLER_ENVIRONMENT); }).not.toThrow();
    expect(() => { assertE2EWranglerEnvironment("production"); }).toThrow(/e2e/u);
    expect(() => { assertE2EWranglerEnvironment(""); }).toThrow(/e2e/u);
  });
});
