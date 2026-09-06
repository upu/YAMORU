import { describe, expect, it } from "vitest";

import { findItemTypeKnowledge } from "../src/lib/managed-items/item-type-knowledge";
import {
  buildItemTypePrompt,
  type ItemTypeSuggestionContext,
  parseItemTypeSuggestions,
} from "../src/lib/managed-items/item-type-suggestion";

function context(
  overrides: Partial<ItemTypeSuggestionContext> = {},
): ItemTypeSuggestionContext {
  return {
    adoptions: [],
    currentItemTypeText: "",
    householdItemTypes: [],
    itemName: "デロンギ マグニフィカS",
    kindLabel: "備品",
    knowledge: [],
    note: "",
    productInfo: "",
    ...overrides,
  };
}

describe("YAMORU専用の詳しい種類の知識(Issue #332)", () => {
  it("メーカー名や製品名などの関連語から代表的な種類を引く", () => {
    const matches = findItemTypeKnowledge({
      kindCode: "asset",
      text: "デロンギ マグニフィカS",
    });

    expect(matches.at(0)?.label).toBe("コーヒーマシン");
    expect(matches.at(0)?.variants).toContain("全自動コーヒーマシン");
  });

  it("選択中の大分類の知識だけを返す", () => {
    expect(findItemTypeKnowledge({ kindCode: "service", text: "デロンギ" })).toEqual([]);
    expect(
      findItemTypeKnowledge({ kindCode: "service", text: "Netflixの契約" }).at(0),
    ).toMatchObject({ label: "動画配信サービス" });
  });

  it("手がかりが無ければ何も返さず、知識全体をAIへ送らない", () => {
    expect(findItemTypeKnowledge({ kindCode: "asset", text: "" })).toEqual([]);
    expect(findItemTypeKnowledge({ kindCode: "asset", text: "名前のない何か" })).toEqual([]);
  });
});

describe("AI提案のプロンプト(Issue #332)", () => {
  it("入力中の情報、家庭内の既存の種類、過去の採用結果、専用知識を渡す", () => {
    const prompt = buildItemTypePrompt(context({
      adoptions: [
        {
          adoptedLabel: "全自動コーヒーマシン",
          adoptionKind: "corrected",
          itemName: "デロンギ ディナミカ",
          suggestedLabels: ["コーヒーメーカー"],
        },
      ],
      currentItemTypeText: "コーヒー",
      householdItemTypes: ["コーヒーマシン"],
      knowledge: findItemTypeKnowledge({ kindCode: "asset", text: "デロンギ" }),
      note: "リビングに置いている",
      productInfo: "De'Longhi ECAM23120",
    }));

    expect(prompt).toContain("名前: デロンギ マグニフィカS");
    expect(prompt).toContain("大分類: 備品");
    expect(prompt).toContain("メーカー・商品名: De'Longhi ECAM23120");
    expect(prompt).toContain("メモ: リビングに置いている");
    expect(prompt).toContain("入力途中の詳しい種類: コーヒー");
    expect(prompt).toContain("この家庭で使用中の詳しい種類");
    expect(prompt).toContain("「デロンギ ディナミカ」では提案(コーヒーメーカー)ではなく「全自動コーヒーマシン」が採用された");
    expect(prompt).toContain("カプセル式コーヒーマシン");
  });

  it("未入力の項目は見出しごと省き、余計な情報をAIへ送らない", () => {
    const prompt = buildItemTypePrompt(context());

    expect(prompt).not.toContain("メモ:");
    expect(prompt).not.toContain("メーカー・商品名:");
    expect(prompt).not.toContain("入力途中の詳しい種類:");
    expect(prompt).not.toContain("この家庭で使用中の詳しい種類");
    expect(prompt).not.toContain("この家庭の過去の提案と採用結果");
  });
});

describe("AI返答からの候補の取り出し(Issue #332)", () => {
  it("前置きが付いていてもJSON配列から候補を取り出す", () => {
    expect(
      parseItemTypeSuggestions('候補です: ["コーヒーマシン", "全自動コーヒーマシン"]'),
    ).toEqual(["コーヒーマシン", "全自動コーヒーマシン"]);
  });

  it("候補は3件までに絞り、重複と空文字と長すぎる値を落とす", () => {
    const raw = JSON.stringify([
      "コーヒーマシン",
      " コーヒーマシン ",
      "",
      "あ".repeat(51),
      "全自動コーヒーマシン",
      "カプセル式コーヒーマシン",
      "ドリップ式コーヒーメーカー",
    ]);

    expect(parseItemTypeSuggestions(raw)).toEqual([
      "コーヒーマシン",
      "全自動コーヒーマシン",
      "カプセル式コーヒーマシン",
    ]);
  });

  it("大文字小文字だけが違う表記は、家庭で使っている表記へ揃える", () => {
    expect(
      parseItemTypeSuggestions('["iot見守りサービス"]', ["ピアノ教室", "IoT見守りサービス"]),
    ).toEqual(["IoT見守りサービス"]);
  });

  it("配列の後ろに文章や別の角括弧が続いても、最初の配列から候補を取り出す", () => {
    expect(
      parseItemTypeSuggestions('["コーヒーマシン", "全自動コーヒーマシン"] はいかがでしょうか。[参考]'),
    ).toEqual(["コーヒーマシン", "全自動コーヒーマシン"]);
  });

  it("JSON配列を読み取れない返答は候補なしとして扱う", () => {
    expect(parseItemTypeSuggestions("コーヒーマシンはいかがでしょうか")).toEqual([]);
    expect(parseItemTypeSuggestions('["壊れたJSON')).toEqual([]);
    expect(parseItemTypeSuggestions('{"label": "コーヒーマシン"}')).toEqual([]);
  });
});
