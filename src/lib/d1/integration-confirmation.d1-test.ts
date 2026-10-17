import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCommandService } from "../../features/integration/commands/service";
import type { IntegrationPrincipal } from "../../features/integration/principal";
import { approveConfirmation, denyConfirmation, loadConfirmation } from "./integration-confirmations";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  connectPrincipal,
  createEverySaturdayTodo,
  expectCommandError,
  familyMember,
  interruptBeforeBatch,
  testClock,
} from "./test-support/integration-commands";
import { applyAllMigrations } from "./test-support/migrations";
import { postponeTaskOccurrence } from "./todos";

// 外部commandの追加確認(#437、YDR-062)を実D1で確かめる。staleになった操作と
// 作り直しをサーバーが追跡し、意味のある差分が出たときだけ本人の確認を求めること、
// 操作IDや接続を変えても回避できないこと、承認・tokenが一つの操作にだけ効くことを検証する。
const db = env.DB;
const memberA = { householdId: "household-a", userId: householdAMember.userId };
const SECRET = "confirmation-test-secret-with-32-bytes!";
const ISSUER = "https://yamoru.example.test";

type Prepared = {
  confirmation: Record<string, unknown>;
  fingerprint: string;
  operation_id: string;
  preview_id: string;
} & Record<string, unknown>;

let principal: IntegrationPrincipal;
let occurrenceId: string;
let clock: ReturnType<typeof testClock>;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await addFamilyMember(db);
  principal = await connectPrincipal(db, memberA);
  occurrenceId = await createEverySaturdayTodo(db);
  clock = testClock();
});

function service(database: D1Database = db) {
  return createCommandService({ config: { issuer: ISSUER }, cursorSecret: SECRET, db: database, now: clock.now });
}

function reschedule(dueOn = "2026-10-14") {
  return {
    command: "todo.reschedule",
    operation_id: crypto.randomUUID(),
    payload: { new_due_on: dueOn },
    target: { id: occurrenceId, kind: "todo_occurrence" },
  };
}

async function prepare(request: unknown, by = principal): Promise<Prepared> {
  return await service().prepare(by, request) as Prepared;
}

function commitInput(prepared: Prepared, token?: unknown) {
  return {
    fingerprint: prepared.fingerprint,
    operation_id: prepared.operation_id,
    preview_id: prepared.preview_id,
    ...(token === undefined ? {} : { confirmation_token: token }),
  };
}

// 家庭の無関係な更新(世代だけが進む)。
async function unrelatedUpdate() {
  await db.prepare("UPDATE managed_items SET name = name || '!' WHERE id = 'item-a'").run();
}

// 家族がWebで今回の期限を延ばす。延期のpreviewにとって意味のある変化。
async function familyPostpones(dueAt = "2027-01-05T15:00:00.000Z") {
  await postponeTaskOccurrence(db, familyMember, occurrenceId, dueAt);
}

// 最初の操作を古いpreviewとして拒否させ、作り直しの連鎖を始める。
async function staleFirst(change: () => Promise<void>) {
  const first = await prepare(reschedule());
  expect(first.confirmation).toEqual({ reason_codes: [], state: "not_needed" });
  await change();
  await expectCommandError(service().commit(principal, commitInput(first)), "stale_preview");
  return first;
}

async function tokenOf(prepared: Prepared, by = principal): Promise<unknown> {
  const got = await service().get(by, { operation_id: prepared.operation_id });
  return got.confirmation_token;
}

describe("確認が必要かの判定", () => {
  it("無関係な家庭の更新でrevisionだけが変わった作り直しは、確認を求めない", async () => {
    await staleFirst(unrelatedUpdate);
    const again = await prepare(reschedule());
    expect(again.confirmation).toEqual({ reason_codes: [], state: "not_needed" });
    await expect(service().commit(principal, commitInput(again))).resolves.toMatchObject({ status: "succeeded" });
  });

  it("「今」を使う完了は、作り直すたびに進む時刻ではなく実施日で比べる", async () => {
    const complete = () => ({
      command: "todo.complete", operation_id: crypto.randomUUID(), payload: {}, target: { id: occurrenceId, kind: "todo_occurrence" },
    });
    const first = await prepare(complete());
    await unrelatedUpdate();
    await expectCommandError(service().commit(principal, commitInput(first)), "stale_preview");
    clock.advance(60_000);
    await expect(prepare(complete())).resolves.toMatchObject({ confirmation: { state: "not_needed" } });
  });

  it("意味のある差分が出た作り直しは、確認画面を示して確認を必須にする", async () => {
    await staleFirst(familyPostpones);
    const again = await prepare(reschedule());
    expect(again.confirmation).toEqual({
      confirmation_url: `${ISSUER}/settings/integrations/operations/${again.preview_id}/confirm`,
      expires_at: again.expires_at,
      reason_codes: ["changed_after_stale_preview"],
      state: "required",
      status: "pending",
    });
    const error = await expectCommandError(service().commit(principal, commitInput(again)), "confirmation_required");
    expect(error.operationId).toBe(again.operation_id);
    // 確定させないので、承認後に同じ操作IDで実行できる。
    await expect(service().get(principal, { operation_id: again.operation_id })).resolves.toMatchObject({
      confirmation_status: "pending", status: "prepared",
    });
  });

  it("新しい操作IDや別の接続で作り直しても、確認を回避できない", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    expect(required.confirmation).toMatchObject({ state: "required" });
    // 確認しないまま、別の操作IDで作り直す。
    await expect(prepare(reschedule())).resolves.toMatchObject({ confirmation: { state: "required" } });
    // 再接続(別の接続)でも同じ本人・家庭・対象なので追跡する。
    const reconnected = await connectPrincipal(db, memberA);
    expect(reconnected.connectionId).not.toBe(principal.connectionId);
    await expect(prepare(reschedule(), reconnected)).resolves.toMatchObject({ confirmation: { state: "required" } });
  });
});

describe("承認とtoken", () => {
  it("本人の承認後だけoperation_getがtokenを返し、tokenを添えたcommitが一度だけ実行される", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    await expect(tokenOf(required)).resolves.toBeUndefined();
    // 確認画面には、前に確認した内容と今回の内容の両方を出す。
    const view = await loadConfirmation(db, householdAMember, required.preview_id);
    expect(view).toMatchObject({ clientName: "Example Assistant", operation: { previewId: required.preview_id } });
    expect(view?.baselinePreview).not.toBeNull();

    await expect(approveConfirmation(db, householdAMember, required.preview_id, clock.now().toISOString())).resolves.toBe("approved");
    const token = await tokenOf(required);
    expect(typeof token).toBe("string");
    await expectCommandError(service().commit(principal, commitInput(required, `${String(token)}x`)), "confirmation_required");
    // 復号できない長さのtokenも、一時的な失敗ではなく確認が必要として返す。
    await expectCommandError(service().commit(principal, commitInput(required, "A".repeat(17))), "confirmation_required");
    await expectCommandError(service().commit(principal, commitInput(required)), "confirmation_required");
    const committed = await service().commit(principal, commitInput(required, token));
    expect(committed).toMatchObject({ result: { due_on: "2026-10-14" }, status: "succeeded" });
    // 成功後の再送は保存した結果を返し、tokenでも再実行しない。
    await expect(service().commit(principal, commitInput(required, token))).resolves.toEqual({ ...committed, replayed: true });
    await expect(service().get(principal, { operation_id: required.operation_id })).resolves.not.toHaveProperty("confirmation_token");
  });

  it("他の家族は承認できず、別の接続からはtokenを受け取れない", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    await expect(approveConfirmation(db, familyMember, required.preview_id, clock.now().toISOString())).resolves.toBe("not_pending");
    await expect(loadConfirmation(db, familyMember, required.preview_id)).resolves.toBeNull();
    await approveConfirmation(db, householdAMember, required.preview_id, clock.now().toISOString());
    const reconnected = await connectPrincipal(db, memberA);
    await expect(service().get(reconnected, { operation_id: required.operation_id })).resolves.toMatchObject({ status: "unknown" });
    await expect(service().get(reconnected, { operation_id: required.operation_id })).resolves.not.toHaveProperty("confirmation_token");
  });

  it("拒否した操作は実行できず、作り直しても確認待ちが続く", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    await expect(denyConfirmation(db, householdAMember, required.preview_id, clock.now().toISOString())).resolves.toBe("denied");
    await expect(service().get(principal, { operation_id: required.operation_id })).resolves.toMatchObject({
      confirmation_status: "denied", status: "rejected",
    });
    await expectCommandError(service().commit(principal, commitInput(required)), "confirmation_denied");
    await expect(prepare(reschedule())).resolves.toMatchObject({ confirmation: { state: "required" } });
  });

  it("期限を過ぎた確認は承認できない", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    clock.advance(11 * 60 * 1000);
    await expect(service().get(principal, { operation_id: required.operation_id })).resolves.toMatchObject({ confirmation_status: "expired" });
    await expect(approveConfirmation(db, householdAMember, required.preview_id, clock.now().toISOString())).resolves.toBe("expired");
  });

  it("承認の時点で家庭の世代が変わっていれば承認せず、古いpreviewとして確定させる", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    await unrelatedUpdate();
    await expect(approveConfirmation(db, householdAMember, required.preview_id, clock.now().toISOString())).resolves.toBe("stale");
    await expect(service().get(principal, { operation_id: required.operation_id })).resolves.toMatchObject({
      error: { code: "stale_preview" }, status: "rejected",
    });
  });
});

describe("確認後の変化", () => {
  it("承認の後に内容が変われば、古い承認・tokenは作り直した操作に効かない", async () => {
    await staleFirst(familyPostpones);
    const approved = await prepare(reschedule());
    await approveConfirmation(db, householdAMember, approved.preview_id, clock.now().toISOString());
    const oldToken = await tokenOf(approved);
    // 承認の後、実行の前に家族がまた期限を変える。
    const racing = interruptBeforeBatch(db, () => familyPostpones("2027-02-05T15:00:00.000Z"));
    await expectCommandError(service(racing).commit(principal, commitInput(approved, oldToken)), "stale_preview");
    const remade = await prepare(reschedule());
    expect(remade.confirmation).toMatchObject({ state: "required" });
    await expectCommandError(service().commit(principal, commitInput(remade, oldToken)), "confirmation_required");
  });

  it("承認した内容と同じなら、無関係な更新の後の作り直しは確認を求めない", async () => {
    await staleFirst(familyPostpones);
    const approved = await prepare(reschedule());
    await approveConfirmation(db, householdAMember, approved.preview_id, clock.now().toISOString());
    const racing = interruptBeforeBatch(db, unrelatedUpdate);
    await expectCommandError(service(racing).commit(principal, commitInput(approved, await tokenOf(approved))), "stale_preview");
    await expect(prepare(reschedule())).resolves.toMatchObject({ confirmation: { state: "not_needed" } });
  });

  it("承認されていない確認必須の操作は、DBでも成功にできない", async () => {
    await staleFirst(familyPostpones);
    const required = await prepare(reschedule());
    await expect(db.prepare(
      "UPDATE integration_operations SET status = 'succeeded', result = '{}', resolved_at = ?2 WHERE preview_id = ?1",
    ).bind(required.preview_id, clock.now().toISOString()).run()).rejects.toThrow(/confirmation required/u);
  });
});
