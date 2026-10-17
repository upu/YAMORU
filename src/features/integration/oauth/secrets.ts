// OAuthで発行する秘密(authorization code・access token・refresh token)の
// 生成とhash化。秘密は256bitの乱数で推測できないため、保存・照合には
// 塩なしSHA-256で足りる。生の値はD1にもログにも残さない。

const TOKEN_BYTES = 32;

// 種類を示す接頭辞を付け、漏えい時にsecret scanning等で見分けられるようにする。
export const SECRET_PREFIXES = {
  accessToken: "ymr_at_",
  authorizationCode: "ymr_ac_",
  refreshToken: "ymr_rt_",
} as const;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function generateSecret(prefix: string): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64Url(bytes)}`;
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
