// Issue #116スパイク: bcrypt等のネイティブ実装はCloudflare Workers(WASM無し)では
// 使いにくいため、Workers/Nodeどちらでも動くWeb Crypto(PBKDF2)でパスワードを扱う。
// 本番品質のパラメータ調整はスパイクの範囲外。

const ITERATIONS = 100_000;
const HASH_ALGORITHM = "SHA-256";
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  // atob由来のデコード結果は常に新規ArrayBuffer裏付けだが、TypeScriptの
  // Uint8Array.from()シグネチャはArrayBufferLike(SharedArrayBuffer含む)を
  // 返す型になっているため、BufferSourceへ渡す前に明示する。
  return new Uint8Array(
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
  );
}

async function deriveKey(password: string, salt: BufferSource): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: HASH_ALGORITHM },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(password, salt);
  return `${toBase64(salt)}.${toBase64(derived)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(".");
  const saltPart = parts.at(0);
  const hashPart = parts.at(1);
  if (saltPart === undefined || hashPart === undefined) {
    return false;
  }
  const salt = fromBase64(saltPart);
  const derived = await deriveKey(password, salt);
  return toBase64(derived) === hashPart;
}
