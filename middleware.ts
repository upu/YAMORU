import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const runtime = "experimental-edge";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
