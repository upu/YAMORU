import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { sharedAuthConfig } from "./auth.config";
import { authenticateCredentials } from "./lib/d1/authentication";
import { getD1Database } from "./lib/d1/client";

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...sharedAuthConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials.email;
        const password = credentials.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const db = await getD1Database();
        return authenticateCredentials(db, email, password);
      },
    }),
  ],
});
