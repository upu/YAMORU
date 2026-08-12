import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

// YAMORU_ALLOWED_DEV_ORIGINSの解釈は lib/dev-origins.ts の
// parseAllowedDevOrigins と揃えています。このスクリプトはNode単体で
// next devより前に実行するため、Next.js経由のTypeScript解決に頼らず
// 同じ分割ロジックをここに複製しています。
function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const CERT_DIR = resolve(process.cwd(), ".certs/dev");
const KEY_PATH = resolve(CERT_DIR, "key.pem");
const CERT_PATH = resolve(CERT_DIR, "cert.pem");
const BASE_HOSTS = ["localhost", "127.0.0.1", "::1"];

function resolveHosts(): string[] {
  const fromEnv = parseAllowedOrigins(process.env.YAMORU_ALLOWED_DEV_ORIGINS);
  return [...new Set([...BASE_HOSTS, ...fromEnv])];
}

function findMkcertPath(): string {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(lookupCommand, ["mkcert"], {
      encoding: "utf8",
    });
    const firstLine = output.split(/\r?\n/).find((line) => line.length > 0);
    if (!firstLine) {
      throw new Error("empty lookup result");
    }
    return firstLine;
  } catch {
    throw new Error(
      "mkcertが見つかりません。Windowsでは`choco install mkcert`または" +
        "`scoop install mkcert`でインストールしてください。詳細はREADMEの" +
        "「ローカル開発サーバーをHTTPSで起動する」を参照してください。" +
        "HTTPで起動する場合は`npm run dev:http`を使用してください。",
    );
  }
}

function isCertValidForHosts(hosts: string[]): boolean {
  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    return false;
  }

  try {
    const cert = new X509Certificate(readFileSync(CERT_PATH));

    // 期限切れの証明書は、LANのIPが変わっていなくても再生成の対象にします。
    if (new Date(cert.validTo).getTime() <= Date.now()) {
      return false;
    }

    return hosts.every((host) =>
      isIP(host)
        ? cert.checkIP(host) !== undefined
        : cert.checkHost(host) !== undefined,
    );
  } catch {
    // 破損した証明書ファイルも再生成の対象にします。
    return false;
  }
}

function printCaRootLocation(mkcertPath: string): void {
  const caRoot = execFileSync(mkcertPath, ["-CAROOT"], {
    encoding: "utf8",
  }).trim();
  console.log(`ローカルCAの場所: ${caRoot}`);
  console.log(
    "iPhoneなど別端末で信頼させる手順はREADMEの" +
      "「ローカル開発サーバーをHTTPSで起動する」を参照してください。",
  );
}

function generateCertificate(mkcertPath: string, hosts: string[]): void {
  mkdirSync(CERT_DIR, { recursive: true });
  console.log(`証明書を生成します(対象ホスト: ${hosts.join(", ")})`);
  execFileSync(
    mkcertPath,
    ["-install", "-key-file", KEY_PATH, "-cert-file", CERT_PATH, ...hosts],
    { stdio: "inherit" },
  );
}

function main(): void {
  const hosts = resolveHosts();

  if (isCertValidForHosts(hosts)) {
    console.log(
      "既存の証明書は有効期限内で、対象ホストをすべて満たしています。",
    );
    // 証明書が既にあっても、iPhoneなど別端末での信頼設定に必要な
    // CAの場所は毎回案内します。mkcertが見つからなくても、既存の
    // 証明書があれば起動は継続します。
    try {
      printCaRootLocation(findMkcertPath());
    } catch {
      // 案内できないだけで、起動は継続します。
    }
    return;
  }

  const mkcertPath = findMkcertPath();
  generateCertificate(mkcertPath, hosts);
  printCaRootLocation(mkcertPath);
}

main();
