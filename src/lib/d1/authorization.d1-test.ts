import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listAuthorizedManagedItems,
  updateAuthorizedManagedItemName,
} from "./authorization";
import {
  D1ForbiddenError,
  D1UnauthorizedError,
} from "./errors";
import {
  createFirstHousehold,
  createProfile,
  updateProfile,
} from "./households";
import {
  cancelHouseholdInvitation,
  issueHouseholdInvitation,
  listHouseholdInvitations,
} from "./invitations";
import {
  getManagedItem,
  listManagedItems,
} from "./managed-items";
import { createOneTimeTask } from "./todos";
import {
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

// スキーマ全体と、家庭所属にもとづく読み書きの認可、プロフィール・家庭の作成、
// 招待の発行と取り消し。台帳・Todoの領域は同じtest-support/を使う別ファイルにある。

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("D1 formal schema and household authorization", () => {
  it("formal migration creates every application table", async () => {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name")
      .all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "activity_logs",
      "external_links",
      "invitation_claims",
      "household_invitations",
      "household_members",
      "households",
      "managed_items",
      "managed_item_classifications",
      "managed_item_kinds",
      "managed_item_type_presets",
      "profiles",
      "task_occurrences",
      "task_rules",
      "users",
    ]));
  });

  it("members can read only their own household", async () => {
    await expect(listAuthorizedManagedItems(db, householdAMember, "household-a"))
      .resolves.toEqual([{ id: "item-a", household_id: "household-a", name: "Item A" }]);
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-b"))
      .resolves.toEqual([{ id: "item-b", household_id: "household-b", name: "Item B" }]);
    await expect(listAuthorizedManagedItems(db, householdAMember, "household-b"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-a"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
  });

  it("rejects non-members and unauthenticated callers", async () => {
    await expect(listAuthorizedManagedItems(db, nonMember, "household-a"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
    await expect(listAuthorizedManagedItems(db, null, "household-a"))
      .rejects.toBeInstanceOf(D1UnauthorizedError);
    await expect(createOneTimeTask(db, null, {
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "Unauthorized",
    })).rejects.toBeInstanceOf(D1UnauthorizedError);
  });

  it("does not read or update a B row with an authorized A session and a B ID", async () => {
    await expect(updateAuthorizedManagedItemName(
      db, householdAMember, "household-a", "item-b", "Hacked",
    )).resolves.toBe(0);
    await expect(listManagedItems(db, householdAMember)).resolves.toEqual([
      {
        id: "item-a",
        itemTypeCode: "other",
        itemTypeLabel: "その他",
        kindCode: "other",
        kindLabel: "その他",
        name: "Item A",
      },
    ]);
    await expect(getManagedItem(db, householdAMember, "item-b")).resolves.toBeNull();
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-b"))
      .resolves.toEqual([{ id: "item-b", household_id: "household-b", name: "Item B" }]);
  });

});

describe("D1 profile and household creation", () => {
  it("profiles are account-scoped and duplicate submission is idempotent", async () => {
    await createProfile(db, householdAMember, "Alice");
    await createProfile(db, householdAMember, "Ignored duplicate");
    await updateProfile(db, householdAMember, "Alice updated");
    await expect(db.prepare(
      "SELECT nickname FROM profiles WHERE user_id = 'user-a'",
    ).first()).resolves.toMatchObject({ nickname: "Alice updated" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM profiles WHERE user_id = 'user-b'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("first-household creation derives membership from the session", async () => {
    await createFirstHousehold(db, nonMember, "Outsider household");
    await expect(db.prepare(
      "SELECT h.name FROM households h JOIN household_members m ON m.household_id = h.id WHERE m.user_id = 'user-outsider'",
    ).first()).resolves.toMatchObject({ name: "Outsider household" });
  });

  it("a household insert failure does not leave a membership", async () => {
    await expect(createFirstHousehold(db, nonMember, ""))
      .rejects.toThrow();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM household_members WHERE user_id = 'user-outsider'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });
});

describe("D1 invitation issuance and household isolation", () => {
  it("stores only the token hash and reissue replaces the previous pending invitation", async () => {
    const first = await issueHouseholdInvitation(
      db, householdAMember, " Guest@Example.com ", new Date("2026-08-20T00:00:00.000Z"),
    );
    const second = await issueHouseholdInvitation(
      db, householdAMember, "guest@example.com", new Date("2026-08-21T00:00:00.000Z"),
    );
    const rows = await db.prepare(
      "SELECT id, token_hash, status FROM household_invitations WHERE household_id = 'household-a' ORDER BY created_at",
    ).all<{ id: string; status: string; token_hash: string }>();
    expect(first.token).not.toBe(second.token);
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({ id: first.invitationId, status: "replaced" });
    expect(rows.results[1]).toMatchObject({ id: second.invitationId, status: "pending" });
    expect(rows.results.some(({ token_hash: hash }) => hash === first.token || hash === second.token))
      .toBe(false);
  });

  it("a failed reissue rolls back replacement of the existing invitation", async () => {
    const first = await issueHouseholdInvitation(db, householdAMember, "guest@example.com");
    await expect(issueHouseholdInvitation(db, householdAMember, "x"))
      .rejects.toThrow();
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(first.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("lists and cancels only invitations in the current household", async () => {
    const a = await issueHouseholdInvitation(db, householdAMember, "a-guest@example.com");
    const b = await issueHouseholdInvitation(db, householdBMember, "b-guest@example.com");
    await expect(cancelHouseholdInvitation(db, householdAMember, b.invitationId))
      .rejects.toThrow("Invitation is not pending");
    expect((await listHouseholdInvitations(db, householdAMember)).map(({ id }) => id))
      .toEqual([a.invitationId]);
    expect((await listHouseholdInvitations(db, householdBMember)).map(({ id }) => id))
      .toEqual([b.invitationId]);
    await cancelHouseholdInvitation(db, householdAMember, a.invitationId);
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(b.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });
});
