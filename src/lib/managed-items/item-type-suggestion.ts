import type { ItemTypeAdoption } from "../d1/item-type-suggestions";
import type { ItemTypeKnowledgeEntry } from "./item-type-knowledge";
import { normalizeItemTypeText } from "./item-type-text";

// Issue #332: AIへ渡す提案文脈と、AIの返答から候補を取り出す処理。AI呼び出し
// そのもの(src/lib/ai/)から切り離し、文脈の作り方と候補の整え方だけを
// 単体テストできるようにする。
export const MAX_ITEM_TYPE_SUGGESTIONS = 3;
// 採用されるとそのままcustomItemTypeとして保存されるため、フォームと同じ
// 上限(actions.tsのCUSTOM_ITEM_TYPE_MAX_LENGTH)を超える候補は捨てる。
const SUGGESTION_MAX_LENGTH = 50;
// AIへ送るのは分類の手がかりになる範囲だけにする(「AIへ送信する情報は必要
// 最小限にする」)。メモは全文ではなく先頭だけを渡す。
const NOTE_MAX_LENGTH = 200;
const HOUSEHOLD_ITEM_TYPE_LIMIT = 20;
const ADOPTION_LIMIT = 5;

export type ItemTypeSuggestionContext = {
  adoptions: ItemTypeAdoption[];
  currentItemTypeText: string;
  householdItemTypes: string[];
  itemName: string;
  kindLabel: string;
  knowledge: ItemTypeKnowledgeEntry[];
  note: string;
  productInfo: string;
};

function section(title: string, lines: string[]): string {
  return lines.length === 0 ? "" : `${title}\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function inputLines(context: ItemTypeSuggestionContext): string[] {
  return [
    `名前: ${context.itemName}`,
    `大分類: ${context.kindLabel}`,
    context.productInfo === "" ? "" : `メーカー・商品名: ${context.productInfo}`,
    context.note === "" ? "" : `メモ: ${context.note.slice(0, NOTE_MAX_LENGTH)}`,
    context.currentItemTypeText === ""
      ? ""
      : `入力途中の詳しい種類: ${context.currentItemTypeText}`,
  ].filter((line) => line !== "");
}

// 過去の提案と採用結果は「提案 → 実際に選ばれた種類」の対で渡す。修正された
// 例をそのまま見せることで、次の提案が家庭の言い方へ寄る。
function adoptionLines(adoptions: ItemTypeAdoption[]): string[] {
  return adoptions.slice(0, ADOPTION_LIMIT).map((adoption) => (
    adoption.adoptionKind === "ai_suggestion"
      ? `「${adoption.itemName}」では提案した「${adoption.adoptedLabel}」がそのまま採用された`
      : `「${adoption.itemName}」では提案(${adoption.suggestedLabels.join("、")})ではなく「${adoption.adoptedLabel}」が採用された`
  ));
}

function knowledgeLines(knowledge: ItemTypeKnowledgeEntry[]): string[] {
  return knowledge.map(
    (entry) => `${entry.label}(${[entry.label, ...entry.variants].join("、")})`,
  );
}

export function buildItemTypePrompt(context: ItemTypeSuggestionContext): string {
  return [
    "あなたは家庭用品・サービスの台帳作成を手伝う日本語アシスタントです。",
    `登録中の対象に合う「詳しい種類」を${String(MAX_ITEM_TYPE_SUGGESTIONS)}件以内で考えてください。`,
    "",
    section("入力中の情報", inputLines(context)),
    section("この家庭で使用中の詳しい種類", context.householdItemTypes.slice(0, HOUSEHOLD_ITEM_TYPE_LIMIT)),
    section("この家庭の過去の提案と採用結果", adoptionLines(context.adoptions)),
    section("参考にできる一般的な種類", knowledgeLines(context.knowledge)),
    "条件:",
    "- 家庭で使用中の表記が合う場合は、新しい言い方を作らずその表記をそのまま返す",
    "- 商品名・型番・メーカー名ではなく、同じ種類のものをまとめられる一般名詞にする",
    `- 1件${String(SUGGESTION_MAX_LENGTH)}文字以内の日本語にする`,
    "- 説明や記号を付けず、候補の文字列だけをJSON配列で返す",
    "",
    '出力例: ["コーヒーマシン", "全自動コーヒーマシン"]',
  ].filter((line) => line !== "").join("\n");
}

function parseLabelArray(text: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((label): label is string => typeof label === "string");
  } catch {
    return null;
  }
}

// 返答からJSON配列を取り出す。指示に従わず前置きや後置きを付ける生成結果が
// あるため、最初の`[`から始まり最初に成立する配列リテラルだけを見る。返答末尾の
// `]`まで一息に切り出すと、配列の後ろに文章や別の角括弧が続くだけで解析に失敗し、
// 正しい候補があるのに「候補なし」になってしまう。取り出せなければ候補なしとして
// 扱う(推測で文章を候補に変えない)。
function extractLabels(raw: string): string[] {
  const start = raw.indexOf("[");
  if (start === -1) return [];
  for (
    let end = raw.indexOf("]", start);
    end !== -1;
    end = raw.indexOf("]", end + 1)
  ) {
    const labels = parseLabelArray(raw.slice(start, end + 1));
    if (labels !== null) return labels;
  }
  return [];
}

// 家庭内に同じ意味の表記があれば、AIの言い回しではなく家庭の表記へ寄せる
// (「家庭内の既存表記を優先し、AIが似た意味の種類を無制限に増やさない」)。
function preferHouseholdLabel(label: string, householdItemTypes: string[]): string {
  const normalized = normalizeItemTypeText(label);
  return householdItemTypes.find(
    (existing) => normalizeItemTypeText(existing) === normalized,
  ) ?? label;
}

export function parseItemTypeSuggestions(
  raw: string,
  householdItemTypes: string[] = [],
): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const label of extractLabels(raw)) {
    const trimmed = label.trim();
    const normalized = normalizeItemTypeText(trimmed);
    if (
      normalized === ""
      || Array.from(trimmed).length > SUGGESTION_MAX_LENGTH
      || seen.has(normalized)
    ) continue;
    seen.add(normalized);
    suggestions.push(preferHouseholdLabel(trimmed, householdItemTypes));
    if (suggestions.length === MAX_ITEM_TYPE_SUGGESTIONS) break;
  }
  return suggestions;
}
