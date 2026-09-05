import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateTextMock,
  getD1ContextMock,
  listHouseholdCustomItemTypesMock,
  listHouseholdItemTypeAdoptionsMock,
  listManagedItemClassificationOptionsMock,
  recordItemTypeSuggestionMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  listHouseholdCustomItemTypesMock: vi.fn(),
  listHouseholdItemTypeAdoptionsMock: vi.fn(),
  listManagedItemClassificationOptionsMock: vi.fn(),
  recordItemTypeSuggestionMock: vi.fn(),
}));

vi.mock("../src/lib/ai/text-generation", () => ({ generateText: generateTextMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/item-type-suggestions", () => ({
  listHouseholdItemTypeAdoptions: listHouseholdItemTypeAdoptionsMock,
  recordItemTypeSuggestion: recordItemTypeSuggestionMock,
}));
vi.mock("../src/lib/d1/managed-items", () => ({
  listHouseholdCustomItemTypes: listHouseholdCustomItemTypesMock,
  listManagedItemClassificationOptions: listManagedItemClassificationOptionsMock,
}));

import { suggestItemTypes } from "../src/app/managed-items/item-type-suggestion-actions";

const SESSION = { userId: "user-a" };
const DB = {};
const UNAVAILABLE_MESSAGE = "いまは候補を出せません。これまでどおり自分で入力できます。";

function input(overrides: Record<string, string> = {}) {
  return {
    currentItemTypeText: "",
    itemName: "デロンギ マグニフィカS",
    kindCode: "asset",
    note: "",
    productInfo: "",
    ...overrides,
  };
}

function generatedPrompt(): string {
  const prompt: unknown = generateTextMock.mock.calls.at(0)?.at(0);
  return typeof prompt === "string" ? prompt : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  getD1ContextMock.mockResolvedValue({ db: DB, session: SESSION });
  listManagedItemClassificationOptionsMock.mockResolvedValue({
    itemTypes: [
      { code: "appliance", kindCode: "asset", label: "家電" },
      { code: "lesson", kindCode: "service", label: "習い事" },
    ],
    kinds: [
      { code: "asset", label: "備品" },
      { code: "service", label: "サービス・契約" },
    ],
  });
  listHouseholdCustomItemTypesMock.mockResolvedValue([
    { kindCode: "asset", label: "コーヒーマシン" },
    { kindCode: "service", label: "ピアノ教室" },
  ]);
  listHouseholdItemTypeAdoptionsMock.mockResolvedValue([]);
  generateTextMock.mockResolvedValue({
    status: "ok",
    text: '["コーヒーマシン", "全自動コーヒーマシン"]',
  });
  recordItemTypeSuggestionMock.mockResolvedValue("suggestion-1");
});

describe("詳しい種類のAI提案(Issue #332)", () => {
  it("候補を返し、提案した内容を家庭の履歴として記録する", async () => {
    await expect(suggestItemTypes(input())).resolves.toEqual({
      status: "ok",
      suggestionId: "suggestion-1",
      suggestions: ["コーヒーマシン", "全自動コーヒーマシン"],
    });

    expect(recordItemTypeSuggestionMock).toHaveBeenCalledWith(DB, SESSION, {
      itemName: "デロンギ マグニフィカS",
      kindCode: "asset",
      suggestedLabels: ["コーヒーマシン", "全自動コーヒーマシン"],
    });
  });

  it("入力中の情報、自家庭の既存の種類、専用知識を提案文脈に使う", async () => {
    await suggestItemTypes(input({
      currentItemTypeText: "コーヒー",
      note: "リビングに置いている",
      productInfo: "ECAM23120",
    }));

    const prompt = generatedPrompt();
    expect(prompt).toContain("デロンギ マグニフィカS");
    expect(prompt).toContain("大分類: 備品");
    expect(prompt).toContain("メモ: リビングに置いている");
    expect(prompt).toContain("入力途中の詳しい種類: コーヒー");
    // 選択中の大分類で使用中の自由入力とプリセットの両方を渡す。
    expect(prompt).toContain("コーヒーマシン");
    expect(prompt).toContain("家電");
    // 専用知識(コーヒーマシンの言い換え)も渡す。
    expect(prompt).toContain("カプセル式コーヒーマシン");
    // 別の大分類でだけ使われている家庭内の種類は混ぜない。
    expect(prompt).not.toContain("ピアノ教室");
  });

  it("自家庭の過去の採用結果だけを次の提案へ渡す", async () => {
    await suggestItemTypes(input());

    expect(listHouseholdCustomItemTypesMock).toHaveBeenCalledWith(DB, SESSION);
    expect(listHouseholdItemTypeAdoptionsMock).toHaveBeenCalledWith(DB, SESSION, "asset");
  });

  it("名前が未入力のときはAIを呼ばずに案内を返す", async () => {
    await expect(suggestItemTypes(input({ itemName: "  " }))).resolves.toEqual({
      message: "先に名前を入力すると候補を出せます。",
      status: "error",
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordItemTypeSuggestionMock).not.toHaveBeenCalled();
  });

  it("AIを使えない・失敗したときは、候補なしとして手入力を続けられる案内を返す", async () => {
    generateTextMock.mockResolvedValue({ status: "unavailable" });
    await expect(suggestItemTypes(input())).resolves.toEqual({
      message: UNAVAILABLE_MESSAGE,
      status: "error",
    });

    generateTextMock.mockResolvedValue({ status: "error" });
    await expect(suggestItemTypes(input())).resolves.toEqual({
      message: UNAVAILABLE_MESSAGE,
      status: "error",
    });

    expect(recordItemTypeSuggestionMock).not.toHaveBeenCalled();
  });

  it("家庭データの読み出しが失敗しても例外を投げない", async () => {
    listHouseholdCustomItemTypesMock.mockRejectedValue(new Error("forbidden"));

    await expect(suggestItemTypes(input())).resolves.toEqual({
      message: UNAVAILABLE_MESSAGE,
      status: "error",
    });
  });

  it("知らない大分類ではAIを呼ばない", async () => {
    await expect(suggestItemTypes(input({ kindCode: "unknown" }))).resolves.toMatchObject({
      status: "error",
    });

    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("候補を読み取れない返答は記録せず、案内だけを返す", async () => {
    generateTextMock.mockResolvedValue({ status: "ok", text: "よく分かりませんでした" });

    await expect(suggestItemTypes(input())).resolves.toEqual({
      message: "候補を思いつきませんでした。名前やメモを足すと変わることがあります。",
      status: "error",
    });
    expect(recordItemTypeSuggestionMock).not.toHaveBeenCalled();
  });
});
