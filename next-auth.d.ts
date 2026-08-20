import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    sessionVersion: number;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      sessionVersion: number;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sessionVersion?: number;
    userId?: string;
  }
}
