import { normalizeItemTypeText } from "../managed-items/item-type-text";
import { requireCurrentHouseholdId, type D1Session } from "./authorization";

// Issue #332: 「詳しい種類」のAI提案と、その提案が出ている状態で最終的に採用
// された種類を家庭単位で記録する(migration 0024)。記録は入力補助の履歴であり、
// 台帳の正本ではない(YDR-008: AIを正しさの基盤にしない)。
export type ItemTypeAdoptionKind = "ai_suggestion" | "corrected";

// 次回の提案へ渡す1件分の履歴。何を提案し、最終的に何が選ばれたかを対にして
// 持つ。採用されなかった提案(adoption_kind IS NULL)はここに現れない。
export type ItemTypeAdoption = {
  adoptedLabel: string;
  adoptionKind: ItemTypeAdoptionKind;
  itemName: string;
  suggestedLabels: string[];
};

type AdoptionRow = {
  adoptedLabel: string;
  adoptionKind: ItemTypeAdoptionKind;
  itemName: string;
  suggestedLabels: string;
};

const ADOPTION_HISTORY_LIMIT = 20;

// suggested_labelsはこのモジュールがJSON配列として書いた列だが、読み出し側は
// 壊れた値でも提案全体を止めないよう、文字列配列以外は空として扱う。
function parseSuggestedLabels(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((label): label is string => typeof label === "string");
  } catch {
    return [];
  }
}

export async function recordItemTypeSuggestion(
  db: D1Database,
  session: D1Session,
  input: { itemName: string; kindCode: string; suggestedLabels: string[] },
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO managed_item_type_suggestions (
       id, household_id, kind_code, item_name, suggested_labels
     ) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(
    id,
    householdId,
    input.kindCode,
    input.itemName,
    JSON.stringify(input.suggestedLabels),
  ).run();
  return id;
}

// 同じ家庭・同じ大分類の採用履歴を新しい順に返す。household_idで絞り込むため、
// 他家庭の提案文脈・採用結果は混ざらない。
export async function listHouseholdItemTypeAdoptions(
  db: D1Database,
  session: D1Session,
  kindCode: string,
): Promise<ItemTypeAdoption[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT item_name AS itemName,
            suggested_labels AS suggestedLabels,
            adopted_label AS adoptedLabel,
            adoption_kind AS adoptionKind
       FROM managed_item_type_suggestions
      WHERE household_id = ?1 AND kind_code = ?2 AND adoption_kind IS NOT NULL
      ORDER BY adopted_at DESC, id DESC
      LIMIT ?3`,
  ).bind(householdId, kindCode, ADOPTION_HISTORY_LIMIT).all<AdoptionRow>();
  return results.map((row) => ({
    adoptedLabel: row.adoptedLabel,
    adoptionKind: row.adoptionKind,
    itemName: row.itemName,
    suggestedLabels: parseSuggestedLabels(row.suggestedLabels),
  }));
}

// 登録・編集で最終的に保存された「詳しい種類」の表示ラベル。プリセットを
// 選んだ場合はコードではなくラベルで記録し、自由入力・既存の種類と同じ
// 土俵で次回の提案へ渡せるようにする。
async function resolveAdoptedLabel(
  db: D1Database,
  input: { customItemType: string | null; itemTypeCode: string | null },
): Promise<string | null> {
  if (input.customItemType !== null) return input.customItemType;
  if (input.itemTypeCode === null) return null;
  const preset = await db.prepare(
    "SELECT label FROM managed_item_type_presets WHERE code = ?1 LIMIT 1",
  ).bind(input.itemTypeCode).first<{ label: string }>();
  return preset?.label ?? null;
}

// issue本文の「採用結果からのフィードバック」の表を、保存できる2値へ落とす。
// 提案と同じ種類ならai_suggestion、別の種類(既存の種類でも新しい自由入力でも)
// ならcorrected。どちらも「最終的に何が採用されたか」を重視した記録で、
// 「提案が採用されなかった」ことだけを否定として残さない。
function classifyAdoption(
  suggestedLabels: string[],
  adoptedLabel: string,
): ItemTypeAdoptionKind {
  const normalized = normalizeItemTypeText(adoptedLabel);
  return suggestedLabels.some((label) => normalizeItemTypeText(label) === normalized)
    ? "ai_suggestion"
    : "corrected";
}

// 提案IDに対する採用結果を1回だけ追記する。
//
// 次のいずれでも何も書かずに終える(呼び出し元は登録・編集を続行できる)。
//   - 提案IDが自家庭のものでない(他家庭の行をIDだけで更新させない)
//   - 既に採用結果が記録されている(二重記録を防ぐ)
//   - 詳しい種類を指定せずに登録した(採用された種類が無い)
// 候補を閉じただけの操作は、そもそも提案IDがフォームから送られないため
// ここへ到達しない(誤った否定フィードバックにしない)。
export async function recordItemTypeAdoption(
  db: D1Database,
  session: D1Session,
  input: {
    customItemType: string | null;
    itemTypeCode: string | null;
    suggestionId: string;
  },
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const row = await db.prepare(
    `SELECT suggested_labels AS suggestedLabels
       FROM managed_item_type_suggestions
      WHERE id = ?1 AND household_id = ?2 AND adoption_kind IS NULL`,
  ).bind(input.suggestionId, householdId).first<{ suggestedLabels: string }>();
  if (row === null) return;

  const adoptedLabel = await resolveAdoptedLabel(db, input);
  if (adoptedLabel === null) return;

  await db.prepare(
    `UPDATE managed_item_type_suggestions
        SET adopted_label = ?3,
            adoption_kind = ?4,
            adopted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?1 AND household_id = ?2 AND adoption_kind IS NULL`,
  ).bind(
    input.suggestionId,
    householdId,
    adoptedLabel,
    classifyAdoption(parseSuggestedLabels(row.suggestedLabels), adoptedLabel),
  ).run();
}
