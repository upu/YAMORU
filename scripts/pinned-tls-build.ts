import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const crate = path.join(root, "packages/pinned-tls");
const scratch = mkdtempSync(path.join(tmpdir(), "yamoru-tls-build-"));
const generated = path.join(scratch, "generated");
const cargo = process.env.CARGO ?? "cargo";
const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
const zig = process.env.ZIG ?? "zig";
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function run(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { cwd: crate, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${String(result.status)})\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function wrapper(mode: "cc" | "ar") {
  const script = path.join(root, "scripts/pinned-tls-tool.mjs");
  const filename = path.join(scratch, `${mode}.${process.platform === "win32" ? "cmd" : "sh"}`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const contents = process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${script}" ${mode} %*\r\n`
    : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} ${mode} "$@"\n`;
  writeFileSync(filename, contents, { mode: 0o700 });
  return filename;
}

function compile() {
  if (process.platform !== "linux") throw new Error("Generate canonical TLS artifacts on Linux (use WSL on Windows)");
  const versions = { platform: process.platform, rust: run(process.env.RUSTC ?? "rustc", ["--version"]), zig: run(zig, ["version"]), bindgen: run(bindgen, ["--version"]) };
  if (!versions.rust.startsWith("rustc 1.99.1 ") || versions.zig !== "0.17.0" || versions.bindgen !== "wasm-bindgen 0.2.129") throw new Error("Use the documented pinned toolchain");
  const cargoHome = process.env.CARGO_HOME;
  if (!cargoHome) throw new Error("Set CARGO_HOME explicitly for reproducible path mapping");
  const env: NodeJS.ProcessEnv = { ...process.env, ZIG: zig, CC_wasm32_unknown_unknown: wrapper("cc"), AR_wasm32_unknown_unknown: wrapper("ar"),
    CARGO_ENCODED_RUSTFLAGS: [`--remap-path-prefix=${crate}=/yamoru-pinned-tls`, `--remap-path-prefix=${cargoHome}=/cargo`].join("\u001f"),
  };
  delete env.RUSTFLAGS;
  const output = run(cargo, ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"], env);
  if (output) console.log(output);
  run(bindgen, [path.join(crate, "target/wasm32-unknown-unknown/release/tls.wasm"), "--target", "web", "--out-dir", generated, "--out-name", "tls"]);
  return versions;
}

type CrateMetadata = { name: string; version: string; license: string | null; manifest_path: string };
function reportDifference(filename: string, actual: Buffer, target: string) {
  const expected = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
  if (filename !== "manifest.json" || expected.length === 0) {
    console.error(JSON.stringify({ filename, expected: hash(expected), actual: hash(actual) }));
    return;
  }
  const before = JSON.parse(expected.toString("utf8")) as Record<string, Record<string, string>>;
  const after = JSON.parse(actual.toString("utf8")) as Record<string, Record<string, string>>;
  for (const section of ["versions", "inputs", "outputs"]) {
    const keys = new Set([...Object.keys(before[section]), ...Object.keys(after[section])]);
    for (const key of keys) {
      if (before[section][key] !== after[section][key]) console.error(JSON.stringify({ section, key, expected: before[section][key], actual: after[section][key] }));
    }
  }
}
function notices() {
  const metadata = JSON.parse(run(cargo, ["metadata", "--locked", "--format-version", "1"])) as { packages: CrateMetadata[] };
  return metadata.packages.filter((entry) => entry.name !== "yamoru-pinned-tls").sort((a, b) => a.name.localeCompare(b.name, "en")).map((entry) => {
    const directory = path.dirname(entry.manifest_path);
    const files = readdirSync(directory).filter((name) => /^(?:licen[cs]e|copying|notice|unlicense)(?:[._-]|$)/iu.test(name)).sort();
    if (!files.length || !entry.license) throw new Error(`Missing license notice: ${entry.name}`);
    return `## ${entry.name} ${entry.version} (${entry.license})\n\n${files.map((name) => `${name}\n${readFileSync(path.join(directory, name), "utf8").replaceAll("\r\n", "\n")}`).join("\n")}\n`;
  }).join("\n");
}

const versions = compile();
writeFileSync(path.join(generated, "THIRD-PARTY-NOTICES.txt"), notices());
const inputs = ["packages/pinned-tls/Cargo.toml", "packages/pinned-tls/Cargo.lock", "packages/pinned-tls/rust-toolchain.toml", "packages/pinned-tls/src/lib.rs", "scripts/pinned-tls-build.ts", "scripts/pinned-tls-tool.mjs"];
const inputHashes = Object.fromEntries(inputs.map((filename) => [filename, hash(readFileSync(path.join(root, filename), "utf8").replaceAll("\r\n", "\n"))]));
const outputHashes = Object.fromEntries(readdirSync(generated).sort().map((filename) => [filename, hash(readFileSync(path.join(generated, filename)))]));
writeFileSync(path.join(generated, "manifest.json"), `${JSON.stringify({ versions, inputs: inputHashes, outputs: outputHashes }, null, 2)}\n`);
const destination = path.join(crate, "generated");
mkdirSync(destination, { recursive: true });
for (const filename of readdirSync(generated)) {
  const actual = readFileSync(path.join(generated, filename));
  const target = path.join(destination, filename);
  if (process.argv.includes("--check")) {
    if (!existsSync(target) || !actual.equals(readFileSync(target))) {
      reportDifference(filename, actual, target);
      throw new Error(`Generated TLS artifact differs: ${filename}`);
    }
  } else writeFileSync(target, actual);
}
console.log(`TLS artifacts ${process.argv.includes("--check") ? "match" : "generated"}: ${JSON.stringify(versions)}`);
