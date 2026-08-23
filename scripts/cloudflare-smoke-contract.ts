export type SmokeCheck = {
  expectedContentType?: string;
  expectedLocationPath?: string;
  expectedText?: string;
  kind: "public" | "redirect";
  pathname: string;
};

export type SmokeResponse = {
  body: string;
  contentType: string | null;
  location: string | null;
  status: number;
};

export const PRODUCTION_SMOKE_CHECKS: readonly SmokeCheck[] = [
  {
    expectedContentType: "application/manifest+json",
    kind: "public",
    pathname: "/manifest.webmanifest",
  },
  { expectedContentType: "image/png", kind: "public", pathname: "/icon.png" },
  {
    expectedContentType: "image/png",
    kind: "public",
    pathname: "/pwa/yamoru-startup-iphone-16-portrait.png",
  },
  {
    expectedContentType: "text/html",
    expectedText: "招待を確認しています",
    kind: "public",
    pathname: "/invitations/accept",
  },
  {
    expectedContentType: "text/html",
    expectedText: "YAMORUへログイン",
    kind: "public",
    pathname: "/login",
  },
  { expectedLocationPath: "/login", kind: "redirect", pathname: "/account" },
];

function locationPath(location: string): string {
  return new URL(location, "https://smoke.invalid").pathname;
}

function assertPublicResponse(
  check: SmokeCheck,
  response: SmokeResponse,
): void {
  if (response.status !== 200) {
    throw new Error(`${check.pathname}は200ではなく${String(response.status)}でした。`);
  }
  if (
    check.expectedContentType !== undefined &&
    !response.contentType?.toLowerCase().includes(check.expectedContentType)
  ) {
    throw new Error(`${check.pathname}のContent-Typeが不正です。`);
  }
  if (check.expectedText !== undefined && !response.body.includes(check.expectedText)) {
    throw new Error(`${check.pathname}に期待する公開内容がありません。`);
  }
}

function assertRedirectResponse(check: SmokeCheck, response: SmokeResponse): void {
  if (![302, 303, 307, 308].includes(response.status) || response.location === null) {
    throw new Error(`${check.pathname}はloginまたは公開入口へredirectしませんでした。`);
  }
  const expectedPath = check.expectedLocationPath;
  if (expectedPath === undefined || locationPath(response.location) !== expectedPath) {
    throw new Error(`${check.pathname}のredirect先が不正です。`);
  }
}

export function assertSmokeResponse(
  check: SmokeCheck,
  response: SmokeResponse,
): void {
  if (check.kind === "public") assertPublicResponse(check, response);
  else assertRedirectResponse(check, response);
}
