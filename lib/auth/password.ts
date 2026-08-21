const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_VERSION = "v1";
const DERIVED_KEY_BYTES = 32;
const SALT_BYTES = 16;

export { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ITERATIONS } from "./password-policy";
import { PASSWORD_HASH_ITERATIONS } from "./password-policy";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt: new Uint8Array(salt) },
    material,
    DERIVED_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derivePassword(password, salt, PASSWORD_HASH_ITERATIONS);
  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_VERSION,
    String(PASSWORD_HASH_ITERATIONS),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const parts = passwordHash.split("$");
  if (parts.length !== 5) return false;
  const [algorithm, version, rawIterations, encodedSalt, encodedDerived] = parts;
  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    version !== PASSWORD_HASH_VERSION
  ) return false;
  const iterations = Number(rawIterations);
  if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > PASSWORD_HASH_ITERATIONS) {
    return false;
  }
  const salt = fromBase64Url(encodedSalt);
  const expected = fromBase64Url(encodedDerived);
  if (salt === null || salt.length !== SALT_BYTES || expected === null || expected.length !== DERIVED_KEY_BYTES) {
    return false;
  }
  const actual = await derivePassword(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}
