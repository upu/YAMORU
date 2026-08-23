import { constantTimeTokenMatch } from "../lib/auth/constant-time-token.ts";
import { bootstrapFirstUser, resetPassword } from "../lib/d1/authentication.ts";
import { D1ConflictError } from "../lib/d1/errors.ts";

type AuthAdminPlatformEnv = {
  AUTH_ADMIN_SESSION_TOKEN: string;
  DB: D1Database;
};

type AuthAdminPayload = {
  command: "bootstrap" | "reset-password";
  email: string;
  passwordHash: string;
};

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function isAuthAdminPayload(value: unknown): value is AuthAdminPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    (payload.command === "bootstrap" || payload.command === "reset-password") &&
    typeof payload.email === "string" &&
    payload.email.includes("@") &&
    typeof payload.passwordHash === "string" &&
    payload.passwordHash.startsWith("pbkdf2-sha256$v1$")
  );
}

const authAdminPlatform = {
  async fetch(request: Request, env: AuthAdminPlatformEnv): Promise<Response> {
    if (request.method !== "POST") return emptyResponse(405);
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!await constantTimeTokenMatch(token, env.AUTH_ADMIN_SESSION_TOKEN)) {
      return emptyResponse(401);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return emptyResponse(400);
    }
    if (!isAuthAdminPayload(payload)) return emptyResponse(400);

    try {
      if (payload.command === "bootstrap") {
        await bootstrapFirstUser(env.DB, payload.email, payload.passwordHash);
      } else {
        await resetPassword(env.DB, payload.email, payload.passwordHash);
      }
      return emptyResponse(204);
    } catch (error) {
      return emptyResponse(error instanceof D1ConflictError ? 409 : 500);
    }
  },
};

export default authAdminPlatform;
