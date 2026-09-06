import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listHouseholdItemTypeAdoptions,
  recordItemTypeAdoption,
  recordItemTypeSuggestion,
} from "./item-type-suggestions";
import {
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

// Issue #332: 「詳しい種類」のAI提案と採用結果の記録、次回提案へ渡す履歴、
// および家庭間分離。

const db = env.DB;

async function suggestForHouseholdA(labels = ["コーヒーマシン", "全自動コーヒーマシン"]) {
  return recordItemTypeSuggestion(db, householdAMember, {
    itemName: "デロンギ マグニフィカS",
    kindCode: "asset",
    suggestedLabels: labels,
  });
}

async function storedRow(id) {
  return db.prepare(
    `SELECT household_id, adopted_label, adoption_kind, adopted_at
       FROM managed_item_type_suggestions WHERE id = ?1`,
  ).bind(id).first();
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("D1 詳しい種類のAI提案と採用結果", () => {
  it("提案はセッションの家庭に紐づき、採用結果は未記録で始まる", async () => {
    const suggestionId = await suggestForHouseholdA();

    expect(await storedRow(suggestionId)).toMatchObject({
      adopted_at: null,
      adopted_label: null,
      adoption_kind: null,
      household_id: "household-a",
    });
    // 採用結果が無い提案は、次回の提案へ渡す履歴に現れない
    // (候補を閉じただけの操作を否定フィードバックにしない)。
    await expect(listHouseholdItemTypeAdoptions(db, householdAMember, "asset"))
      .resolves.toEqual([]);
  });

  it("提案どおりの自由入力が採用されると、肯定のフィードバックとして残る", async () => {
    const suggestionId = await suggestForHouseholdA();

    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: "全自動コーヒーマシン",
      itemTypeCode: null,
      suggestionId,
    });

    expect(await storedRow(suggestionId)).toMatchObject({
      adopted_label: "全自動コーヒーマシン",
      adoption_kind: "ai_suggestion",
    });
    await expect(listHouseholdItemTypeAdoptions(db, householdAMember, "asset"))
      .resolves.toEqual([{
        adoptedLabel: "全自動コーヒーマシン",
        adoptionKind: "ai_suggestion",
        itemName: "デロンギ マグニフィカS",
        suggestedLabels: ["コーヒーマシン", "全自動コーヒーマシン"],
      }]);
  });

  it("提案とは別の種類が採用されると、修正として次回の提案へ渡せる", async () => {
    const suggestionId = await suggestForHouseholdA(["コーヒーメーカー"]);

    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: "エスプレッソマシン",
      itemTypeCode: null,
      suggestionId,
    });

    await expect(listHouseholdItemTypeAdoptions(db, householdAMember, "asset"))
      .resolves.toEqual([{
        adoptedLabel: "エスプレッソマシン",
        adoptionKind: "corrected",
        itemName: "デロンギ マグニフィカS",
        suggestedLabels: ["コーヒーメーカー"],
      }]);
  });

  it("プリセットが採用された場合はコードではなく表示ラベルで記録する", async () => {
    const suggestionId = await suggestForHouseholdA(["家電"]);

    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: null,
      itemTypeCode: "appliance",
      suggestionId,
    });

    expect(await storedRow(suggestionId)).toMatchObject({
      adopted_label: "家電",
      adoption_kind: "ai_suggestion",
    });
  });

  it("詳しい種類を指定せずに登録した場合は採用結果を記録しない", async () => {
    const suggestionId = await suggestForHouseholdA();

    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: null,
      itemTypeCode: null,
      suggestionId,
    });

    expect(await storedRow(suggestionId)).toMatchObject({ adoption_kind: null });
  });

  it("採用結果は一度だけ記録し、後からの上書きを受け付けない", async () => {
    const suggestionId = await suggestForHouseholdA();

    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: "コーヒーマシン",
      itemTypeCode: null,
      suggestionId,
    });
    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: "別の種類",
      itemTypeCode: null,
      suggestionId,
    });

    expect(await storedRow(suggestionId)).toMatchObject({
      adopted_label: "コーヒーマシン",
      adoption_kind: "ai_suggestion",
    });
  });

  it("他家庭の提案IDでは採用結果を書き換えられない", async () => {
    const suggestionId = await suggestForHouseholdA();

    await recordItemTypeAdoption(db, householdBMember, {
      customItemType: "家庭Bの種類",
      itemTypeCode: null,
      suggestionId,
    });

    expect(await storedRow(suggestionId)).toMatchObject({
      adopted_label: null,
      adoption_kind: null,
      household_id: "household-a",
    });
  });

  it("提案履歴には自家庭・同じ大分類のものだけが現れる", async () => {
    const suggestionA = await suggestForHouseholdA();
    await recordItemTypeAdoption(db, householdAMember, {
      customItemType: "コーヒーマシン",
      itemTypeCode: null,
      suggestionId: suggestionA,
    });
    const suggestionB = await recordItemTypeSuggestion(db, householdBMember, {
      itemName: "家庭Bのコーヒーメーカー",
      kindCode: "asset",
      suggestedLabels: ["コーヒーメーカー"],
    });
    await recordItemTypeAdoption(db, householdBMember, {
      customItemType: "家庭Bのコーヒーメーカー",
      itemTypeCode: null,
      suggestionId: suggestionB,
    });

    await expect(listHouseholdItemTypeAdoptions(db, householdBMember, "asset"))
      .resolves.toEqual([expect.objectContaining({ adoptedLabel: "家庭Bのコーヒーメーカー" })]);
    await expect(listHouseholdItemTypeAdoptions(db, householdAMember, "asset"))
      .resolves.toEqual([expect.objectContaining({ adoptedLabel: "コーヒーマシン" })]);
    await expect(listHouseholdItemTypeAdoptions(db, householdAMember, "service"))
      .resolves.toEqual([]);
  });

  it("家庭に所属しない利用者と未認証の要求は拒否する", async () => {
    await expect(recordItemTypeSuggestion(db, nonMember, {
      itemName: "何か",
      kindCode: "asset",
      suggestedLabels: ["何か"],
    })).rejects.toThrow();
    await expect(listHouseholdItemTypeAdoptions(db, nonMember, "asset")).rejects.toThrow();
    await expect(listHouseholdItemTypeAdoptions(db, null, "asset")).rejects.toThrow();
  });
});
