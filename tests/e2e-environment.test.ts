import { describe, expect, it } from "vitest";

import {
  assertE2ETestProject,
  EXPECTED_E2E_PROJECT_ID,
  EXPECTED_E2E_SUPABASE_URL,
} from "../scripts/e2e-environment.ts";

describe("E2E接続先ガード", () => {
  it("YAMORU-testのproject_idとURLだけを許可する", () => {
    expect(() => {
      assertE2ETestProject({
        projectId: EXPECTED_E2E_PROJECT_ID,
        supabaseUrl: EXPECTED_E2E_SUPABASE_URL,
      });
    }).not.toThrow();
  });

  it("prod-localのproject_idならブラウザーやDBへ接続する前に拒否する", () => {
    expect(() => {
      assertE2ETestProject({
        projectId: "YAMORU-prod-local",
        supabaseUrl: EXPECTED_E2E_SUPABASE_URL,
      });
    }).toThrow(/YAMORU-test/);
  });

  it("prod-localのURLならproject_idが正しくても接続前に拒否する", () => {
    expect(() => {
      assertE2ETestProject({
        projectId: EXPECTED_E2E_PROJECT_ID,
        supabaseUrl: "http://127.0.0.1:55321",
      });
    }).toThrow(/58321/);
  });
});
