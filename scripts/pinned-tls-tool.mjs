import { spawnSync } from "node:child_process";

const [mode, ...args] = process.argv.slice(2);
if (!["cc", "ar"].includes(mode)) throw new Error("Expected cc or ar");
const translated = args.map((arg) => arg === "--target=wasm32-unknown-unknown" ? "--target=wasm32-freestanding" : arg);
if (mode === "cc" && process.env.CARGO_HOME) translated.unshift(`-ffile-prefix-map=${process.env.CARGO_HOME}=/cargo`);
const result = spawnSync(process.env.ZIG ?? "zig", [mode, ...translated], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
