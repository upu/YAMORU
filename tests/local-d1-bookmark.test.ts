// @vitest-environment node
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { retryLocalD1Read } from "../src/lib/d1/read-retry";

let platform: PlatformProxy<{ DB: D1Database }> | undefined;
let external: DatabaseSync | undefined;
function fixture() {
  if (!platform || !external) throw new Error("Local D1 fixture not initialized");
  return { platform, external };
}
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "yamoru-d1-bookmark-"));
  const configPath = join(root, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "yamoru-bookmark-test", compatibility_date: "2026-08-19",
    d1_databases: [{ binding: "DB", database_name: "bookmark-fixture", database_id: "local-only-placeholder" }] }));
  platform = await getPlatformProxy({ configPath, persist: { path: join(root, "state") }, remoteBindings: false });
  await platform.env.DB.exec("CREATE TABLE entries(id INTEGER PRIMARY KEY,value TEXT)");
  const state = join(root, "state");
  const file = (await readdir(state, { recursive: true })).find((name) => name.endsWith(".sqlite") && !name.endsWith("metadata.sqlite"));
  if (!file) throw new Error("Temporary D1 fixture missing");
  external = new DatabaseSync(join(state, file));
}, 30_000);
afterAll(async () => { external?.close(); await platform?.dispose(); });

it("ローカルD1の別接続が書き込みを保持しても、回復可能なbookmarkエラーを返す", async () => {
  const { platform, external } = fixture();
  // Next devとE2E fixtureは同じSQLiteを別接続で使う。旧Miniflareでは
  // 読み取り後のbookmark保存がinternal errorへ逃げていた（upstream #14916）。
  for (let attempt = 0; ; attempt++) {
    try { external.exec("BEGIN IMMEDIATE"); break; }
    catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  try {
    await expect(platform.env.DB.prepare("SELECT * FROM entries").all()).rejects.toThrow(/^D1_ERROR: Failed to get session commit token:/);
  } finally { external.exec("ROLLBACK"); }
  expect((await platform.env.DB.prepare("SELECT * FROM entries").all()).results).toEqual([]);
}, 30_000);

it.each(["run", "batch"] as const)("bookmarkの保存に失敗した%sの業務更新を残さず、再試行は一度だけ保存する", async (method) => {
  const { platform, external } = fixture();
  external.exec("DELETE FROM entries");
  const database = platform.env.DB as D1Database & { withSession(mode: "first-primary"): Pick<D1Database, "prepare" | "batch"> & { getBookmark(): string | null } };
  const session = database.withSession("first-primary");
  await session.prepare("SELECT * FROM entries").all();
  const before = session.getBookmark();
  external.exec("CREATE TRIGGER fail_bookmark BEFORE INSERT ON _cf_METADATA WHEN NEW.key=2 BEGIN SELECT RAISE(ABORT,'fixture bookmark failure'); END");
  const insert = session.prepare("INSERT INTO entries(value) VALUES('fictional operation')");
  const execute = () => method === "run" ? insert.run() : session.batch([insert, insert]);
  try {
    await expect(execute()).rejects.toThrow(/^D1_ERROR: Failed to get session commit token:/);
    expect(session.getBookmark()).toBe(before);
    expect(external.prepare("SELECT * FROM entries").all()).toEqual([]);
  } finally { external.exec("DROP TRIGGER fail_bookmark"); }
  await execute();
  expect((await session.prepare("SELECT * FROM entries").all()).results).toHaveLength(method === "run" ? 1 : 2);
}, 30_000);

it("短いロックが解放された後に画面の読み取りを回復する", async () => {
  const { platform, external } = fixture();
  external.exec("DELETE FROM entries; INSERT INTO entries(value) VALUES('read recovery fixture')");
  external.exec("BEGIN IMMEDIATE");
  const lock = { held: true };
  const release = setTimeout(() => { external.exec("ROLLBACK"); lock.held = false; }, 60);
  try {
    const result = await retryLocalD1Read(() => platform.env.DB.prepare("SELECT count(*) AS n FROM entries").first<{ n: number }>());
    expect(result).toEqual({ n: 1 });
  } finally { clearTimeout(release); if (lock.held) external.exec("ROLLBACK"); }
}, 30_000);
