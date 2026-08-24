import type { NextAuthConfig } from "next-auth";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/invitations/accept" ||
    pathname.startsWith("/invitations/accept/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp)$/u.test(pathname)
  );
}

export const sharedAuthConfig = {
  callbacks: {
    authorized({ auth, request }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      return auth !== null;
    },
    jwt({ token, user }) {
      const candidate = user as unknown;
      if (typeof candidate === "object" && candidate !== null) {
        const authenticatedUser = candidate as { id?: unknown; sessionVersion?: unknown };
        if (
          typeof authenticatedUser.id === "string" &&
          typeof authenticatedUser.sessionVersion === "number"
        ) {
          token.userId = authenticatedUser.id;
          token.sessionVersion = authenticatedUser.sessionVersion;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (
        typeof token.userId === "string" &&
        typeof token.sessionVersion === "number"
      ) {
        session.user.id = token.userId;
        session.user.sessionVersion = token.sessionVersion;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  // Cloudflare Workers(preview/production)はHostヘッダーをリクエストURLから
  // 安全に設定するプラットフォームであり、Auth.js公式リファレンスもここでの
  // trustHost: trueを前提とする。既定値はNODE_ENV等の環境変数から間接的に
  // 決まり、本番ビルドでは無効側に倒れてUntrustedHostを起こすため、
  // local/preview/productionで同じ挙動になるようここで明示する(#137)。
  trustHost: true,
} satisfies Omit<NextAuthConfig, "providers">;

export const authConfig = {
  ...sharedAuthConfig,
  providers: [],
} satisfies NextAuthConfig;

export const authMiddlewareConfig = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
