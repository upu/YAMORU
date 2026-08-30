import type { Page, TestInfo } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatPreviewDiagnostics,
  reportPreviewDiagnostics,
  resetPreviewDiagnostics,
  toPathname,
  watchPreviewNavigations,
} from "../e2e/preview/diagnostics";

const PREVIEW_ORIGIN = "https://yamoru-preview.example.test";

type FakeResponse = {
  method: string;
  resourceType: string;
  status: number;
  url: string;
};

function createFakePage(): { emit: (response: FakeResponse) => void; page: Page } {
  let listener: ((response: unknown) => void) | null = null;
  const page = {
    on(event: string, handler: (response: unknown) => void) {
      if (event === "response") listener = handler;
    },
  };
  return {
    emit: (response) => {
      listener?.({
        request: () => ({
          method: () => response.method,
          resourceType: () => response.resourceType,
        }),
        status: () => response.status,
        url: () => response.url,
      });
    },
    page: page as unknown as Page,
  };
}

function testInfoWith(status: string): TestInfo {
  return { expectedStatus: "passed", status } as unknown as TestInfo;
}

// preview-family-sharing-e2e.ymlは配備済みpreviewに対して実行され、この診断は
// GitHub Actionsのログへ出る。生の招待tokenやclaim secretがそこへ残らないことを
// 確認する。
describe("preview E2Eの失敗時診断", () => {
  beforeEach(() => {
    resetPreviewDiagnostics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("URLのqueryとfragmentを落としてpathnameだけにする", () => {
    expect(toPathname(`${PREVIEW_ORIGIN}/invitations/accept#token=raw-token`))
      .toBe("/invitations/accept");
    expect(toPathname(`${PREVIEW_ORIGIN}/login?next=%2Fhousehold`)).toBe("/login");
    expect(toPathname("not a url")).toBe("(unparsable)");
  });

  it("画面遷移とServer Actionだけを、statusとともに記録する", () => {
    const { emit, page } = createFakePage();
    watchPreviewNavigations(page, "owner");

    emit({
      method: "GET",
      resourceType: "document",
      status: 500,
      url: `${PREVIEW_ORIGIN}/household`,
    });
    emit({
      method: "POST",
      resourceType: "fetch",
      status: 200,
      url: `${PREVIEW_ORIGIN}/todos/new`,
    });
    emit({
      method: "GET",
      resourceType: "stylesheet",
      status: 200,
      url: `${PREVIEW_ORIGIN}/_next/static/app.css`,
    });

    const lines = formatPreviewDiagnostics();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("owner GET /household -> 500");
    expect(lines[1]).toContain("owner POST /todos/new -> 200");
  });

  it("招待tokenやclaimを記録に残さない", () => {
    const { emit, page } = createFakePage();
    watchPreviewNavigations(page, "invitee");

    emit({
      method: "GET",
      resourceType: "document",
      status: 200,
      url: `${PREVIEW_ORIGIN}/invitations/accept?claim=secret-claim#token=raw-token`,
    });

    const [line] = formatPreviewDiagnostics();
    expect(line).toContain("/invitations/accept");
    expect(line).not.toContain("raw-token");
    expect(line).not.toContain("secret-claim");
  });

  it("成功したテストでは何も出さない", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    reportPreviewDiagnostics(testInfoWith("passed"));

    expect(log).not.toHaveBeenCalled();
  });
});
