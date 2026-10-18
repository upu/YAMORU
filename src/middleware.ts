import NextAuth from "next-auth";
import type { NextFetchEvent, NextProxy, NextRequest } from "next/server";

import { authConfig } from "./auth.config";

// Auth.js supports the direct middleware export but omits its call overload.
const checkSession = NextAuth(authConfig).auth as NextProxy;

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = await checkSession(request, event);
  // A prefetch or another tab can finish after login/logout. Renewing the old
  // cookie here would restore that user even if handler cookies win per request.
  if (response) response.headers.delete("set-cookie");
  return response;
}

export const runtime = "experimental-edge";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
