import { ReadError, type ReadPrincipal } from "./read-contract";

type Cursor = { scope: string; after: string; expires: number };
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}

export function cursorScope(principal: ReadPrincipal, input: unknown): string {
  return JSON.stringify([principal.householdId, principal.userId, principal.clientId, principal.connectionId, input]);
}

export function createReadCursor(secret: string) {
  if (encoder.encode(secret).length < 32) throw new Error("Read cursor signing key must have at least 32 bytes");
  const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return {
    async encode(scope: string, after: string, now: Date): Promise<string> {
      const payload = encode(encoder.encode(JSON.stringify({ scope, after, expires: now.getTime() + 15 * 60_000 })));
      const mac = await crypto.subtle.sign("HMAC", await key, encoder.encode(payload));
      return `${payload}.${encode(new Uint8Array(mac))}`;
    },
    async decode(token: unknown, scope: string, now: Date): Promise<string> {
      if (token === undefined || token === null) return "";
      try {
        if (typeof token !== "string" || token.length > 8192) throw new ReadError("invalid_cursor");
        const parts = token.split(".");
        const [payload, signature] = parts;
        if (!payload || !signature || parts.length !== 2) throw new ReadError("invalid_cursor");
        if (!await crypto.subtle.verify("HMAC", await key, decode(signature), encoder.encode(payload))) throw new ReadError("invalid_cursor");
        const cursor = JSON.parse(new TextDecoder().decode(decode(payload))) as Cursor;
        if (cursor.scope !== scope || typeof cursor.after !== "string" || !Number.isFinite(cursor.expires)) throw new ReadError("invalid_cursor");
        if (cursor.expires <= now.getTime()) throw new ReadError("cursor_expired");
        return cursor.after;
      } catch (error) {
        if (error instanceof ReadError) throw error;
        throw new ReadError("invalid_cursor");
      }
    },
  };
}
