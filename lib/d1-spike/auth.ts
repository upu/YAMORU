// Issue #116スパイク: B案(D1中心)での認証方式候補としてAuth.js(next-auth v5)を検証する。
// Credentialsプロバイダー+JWTセッション戦略ではAuth.jsのAdapterが不要なため、
// (Adapterが必要になるのはOAuthプロバイダーやDBセッション戦略の場合のみ)、
// @auth/d1-adapterは導入しなかった。既存のSupabase Authログイン(app/login)とは
// 独立させ、このモジュールはスパイク専用に閉じている。
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { findSpikeUserByEmailAndPassword } from "./users";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials.email;
        const password = credentials.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        // Credentialsプロバイダーの認可では、adapterではなくD1バインディングへ
        // 直接問い合わせる(Auth.js公式パターン)。
        const { env } = await getCloudflareContext({ async: true });
        const user = await findSpikeUserByEmailAndPassword(
          env.DB,
          email,
          password,
        );
        if (user === null) {
          return null;
        }
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
