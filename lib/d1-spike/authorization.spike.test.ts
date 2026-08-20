// Issue #116スパイク: household単位のアクセス制御を、RLSではなくアプリ層
// (lib/d1-spike/authorization.ts)だけで担保できるかを、実際のD1(Miniflare)上で検証する。
// 検証マトリクスは既存のRLSスパイク
// (supabase/tests/database/household_rls_isolation.sql)と対にしてある。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import schemaSql from "../../d1/migrations/0001_init_household_spike.sql?raw";
import {
  ForbiddenSpikeError,
  UnauthorizedSpikeError,
  createManagedItem,
  deleteManagedItem,
  isHouseholdMember,
  listManagedItems,
  updateManagedItemName,
} from "./authorization";

const db = env.DB;

const householdAMember = { userId: "user-a" };
const householdBMember = { userId: "user-b" };
const nonMember = { userId: "user-outsider" };
const unauthenticated = null;

beforeAll(async () => {
  // D1Database#exec()は行コメント・空行を含む複数行SQLを受け付けないため
  // (「SQL code did not contain a statement」で落ちる)、コメントを除去して
  // ステートメントごとにprepare().run()する。
  const statements = schemaSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  await db.batch(statements.map((statement) => db.prepare(statement)));
});

beforeEach(async () => {
  // 各テストの前にfixtureを作り直す(RLSスパイクのseed.sqlに相当)。
  await db.batch([
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')",
    ),
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('user-a','a@example.com','x'), ('user-b','b@example.com','x'), ('user-outsider','o@example.com','x')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a'), ('household-b','user-b')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name) VALUES ('item-a','household-a','Item A'), ('item-b','household-b','Item B')",
    ),
  ]);
});

describe("isHouseholdMember", () => {
  it("所属メンバーはtrueになる", async () => {
    await expect(
      isHouseholdMember(db, "household-a", "user-a"),
    ).resolves.toBe(true);
  });

  it("非所属者はfalseになる", async () => {
    await expect(
      isHouseholdMember(db, "household-a", "user-outsider"),
    ).resolves.toBe(false);
  });
});

describe("家庭Aメンバーは家庭Aのmanaged_itemsを読み書きできる", () => {
  it("listできる", async () => {
    const items = await listManagedItems(db, householdAMember, "household-a");
    expect(items).toEqual([
      { id: "item-a", household_id: "household-a", name: "Item A" },
    ]);
  });

  it("createできる", async () => {
    await createManagedItem(db, householdAMember, "household-a", {
      id: "item-a2",
      name: "Item A2",
    });
    const items = await listManagedItems(db, householdAMember, "household-a");
    expect(items.map((item) => item.id)).toContain("item-a2");
  });

  it("updateできる", async () => {
    const changes = await updateManagedItemName(
      db,
      householdAMember,
      "household-a",
      "item-a",
      "Item A Renamed",
    );
    expect(changes).toBe(1);
  });

  it("deleteできる", async () => {
    const changes = await deleteManagedItem(
      db,
      householdAMember,
      "household-a",
      "item-a",
    );
    expect(changes).toBe(1);
  });
});

describe("家庭Bメンバーは家庭Bのmanaged_itemsを読み書きできる(分離が双方向であることの確認)", () => {
  it("listできる", async () => {
    const items = await listManagedItems(db, householdBMember, "household-b");
    expect(items).toEqual([
      { id: "item-b", household_id: "household-b", name: "Item B" },
    ]);
  });
});

describe("家庭Aメンバーは家庭Bのmanaged_itemsを読み書きできない", () => {
  it("listはForbiddenになる", async () => {
    await expect(
      listManagedItems(db, householdAMember, "household-b"),
    ).rejects.toBeInstanceOf(ForbiddenSpikeError);
  });

  it("createはForbiddenになる", async () => {
    await expect(
      createManagedItem(db, householdAMember, "household-b", {
        id: "item-b2",
        name: "Item B2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenSpikeError);
  });

  it("updateはForbiddenになる", async () => {
    await expect(
      updateManagedItemName(
        db,
        householdAMember,
        "household-b",
        "item-b",
        "Hacked",
      ),
    ).rejects.toBeInstanceOf(ForbiddenSpikeError);
  });

  it("deleteはForbiddenになる", async () => {
    await expect(
      deleteManagedItem(db, householdAMember, "household-b", "item-b"),
    ).rejects.toBeInstanceOf(ForbiddenSpikeError);
  });

  it("WHERE household_id句がなければ、正しいhouseholdIdを名乗るだけで他家庭のidを書き換えられてしまう想定に対する回帰確認: 誤ったid/householdId組み合わせは0件更新になる", async () => {
    // 家庭Aのメンバーとして、家庭Aを名乗りつつ家庭Bのitem idを指定した場合、
    // 所属チェックは通るがWHERE household_id = ?の絞り込みで対象0件になる。
    const changes = await updateManagedItemName(
      db,
      householdAMember,
      "household-a",
      "item-b",
      "Hacked",
    );
    expect(changes).toBe(0);
  });
});

describe("非メンバー・未認証は読み書きできない", () => {
  it("非メンバーはForbiddenになる", async () => {
    await expect(
      listManagedItems(db, nonMember, "household-a"),
    ).rejects.toBeInstanceOf(ForbiddenSpikeError);
  });

  it("未認証はUnauthorizedになる", async () => {
    await expect(
      listManagedItems(db, unauthenticated, "household-a"),
    ).rejects.toBeInstanceOf(UnauthorizedSpikeError);
  });
});
