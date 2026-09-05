import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createManagedItemMock, suggestItemTypesMock } = vi.hoisted(() => ({
  createManagedItemMock: vi.fn(),
  suggestItemTypesMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/actions", () => ({
  createManagedItem: createManagedItemMock,
  updateManagedItem: vi.fn(),
}));
vi.mock("../src/app/managed-items/item-type-suggestion-actions", () => ({
  suggestItemTypes: suggestItemTypesMock,
}));

import { ManagedItemForm } from "../src/app/managed-items/managed-item-form";

const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "appliance", kindCode: "asset", label: "家電" },
    { code: "lesson", kindCode: "service", label: "習い事" },
  ],
  kinds: [
    { code: "asset", label: "備品" },
    { code: "service", label: "サービス・契約" },
  ],
};

function renderForm() {
  render(
    <ManagedItemForm
      classificationOptions={CLASSIFICATION_OPTIONS}
      customItemTypeOptions={[{ kindCode: "asset", label: "虫かご" }]}
    />,
  );
}

function suggestButton() {
  return screen.getByRole("button", { name: "詳しい種類の候補を考えてもらう" });
}

function suggestionGroup() {
  return screen.getByRole("group", { name: "考えた詳しい種類の候補から選ぶ" });
}

async function requestSuggestions(): Promise<void> {
  fireEvent.click(suggestButton());
  await waitFor(() => { expect(suggestionGroup()).toBeInTheDocument(); });
}

function hiddenSuggestionId(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[name="itemTypeSuggestionId"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  createManagedItemMock.mockResolvedValue({ message: "", status: "idle" });
  suggestItemTypesMock.mockResolvedValue({
    status: "ok",
    suggestionId: "suggestion-1",
    suggestions: ["コーヒーマシン", "全自動コーヒーマシン"],
  });
});

afterEach(cleanup);

describe("詳しい種類のAI提案(Issue #332)", () => {
  it("ボタンを押すまで提案せず、押した時点の入力内容を送る", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("名前"), {
      target: { value: "デロンギ マグニフィカS" },
    });
    fireEvent.change(screen.getByLabelText("メモ（任意）"), {
      target: { value: "リビングに置いている" },
    });

    expect(suggestItemTypesMock).not.toHaveBeenCalled();

    await requestSuggestions();

    expect(suggestItemTypesMock).toHaveBeenCalledWith({
      currentItemTypeText: "",
      itemName: "デロンギ マグニフィカS",
      kindCode: "asset",
      note: "リビングに置いている",
      productInfo: "",
    });
  });

  it("候補を選ぶと自由入力の詳しい種類へ反映し、提案IDを一緒に送る", async () => {
    renderForm();
    await requestSuggestions();

    expect(hiddenSuggestionId()).toHaveValue("suggestion-1");
    fireEvent.click(
      within(suggestionGroup()).getByRole("button", { name: "全自動コーヒーマシン" }),
    );

    expect(screen.getByLabelText("詳しい種類（任意）")).toHaveValue("__custom__");
    expect(screen.getByLabelText("詳しい種類を入力")).toHaveValue("全自動コーヒーマシン");
    expect(hiddenSuggestionId()).toHaveValue("suggestion-1");
  });

  it("プリセットと同じ表記の候補は、AI専用の値を作らずプリセットを選ぶ", async () => {
    suggestItemTypesMock.mockResolvedValue({
      status: "ok",
      suggestionId: "suggestion-2",
      suggestions: ["家電"],
    });
    renderForm();
    await requestSuggestions();

    fireEvent.click(within(suggestionGroup()).getByRole("button", { name: "家電" }));

    expect(screen.getByLabelText("詳しい種類（任意）")).toHaveValue("appliance");
    expect(screen.queryByLabelText("詳しい種類を入力")).not.toBeInTheDocument();
  });

  it("候補を閉じただけなら提案IDを送らず、否定のフィードバックにしない", async () => {
    renderForm();
    await requestSuggestions();
    expect(hiddenSuggestionId()).toHaveValue("suggestion-1");

    fireEvent.click(screen.getByRole("button", { name: "候補を閉じる" }));

    expect(hiddenSuggestionId()).toBeNull();
    expect(screen.queryByRole("group", { name: "考えた詳しい種類の候補から選ぶ" }))
      .not.toBeInTheDocument();
  });

  it("AIを使わずに登録するときは提案IDを送らない", () => {
    renderForm();

    expect(hiddenSuggestionId()).toBeNull();
    expect(screen.getByLabelText("名前")).toBeInTheDocument();
  });

  it("提案に失敗しても案内を出すだけで、これまでどおり入力できる", async () => {
    suggestItemTypesMock.mockResolvedValue({
      message: "いまは候補を出せません。これまでどおり自分で入力できます。",
      status: "error",
    });
    renderForm();

    fireEvent.click(suggestButton());
    await waitFor(() => {
      expect(
        screen.getByText("いまは候補を出せません。これまでどおり自分で入力できます。"),
      ).toBeInTheDocument();
    });

    expect(hiddenSuggestionId()).toBeNull();
    fireEvent.change(screen.getByLabelText("詳しい種類（任意）"), {
      target: { value: "__custom__" },
    });
    fireEvent.change(screen.getByLabelText("詳しい種類を入力"), {
      target: { value: "コーヒーマシン" },
    });
    expect(screen.getByLabelText("詳しい種類を入力")).toHaveValue("コーヒーマシン");
  });

  it("入力途中の自由入力も提案の手がかりとして送る", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "コーヒーの機械" } });
    fireEvent.change(screen.getByLabelText("詳しい種類（任意）"), {
      target: { value: "__custom__" },
    });
    fireEvent.change(screen.getByLabelText("詳しい種類を入力"), {
      target: { value: "コーヒー" },
    });

    await requestSuggestions();

    expect(suggestItemTypesMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentItemTypeText: "コーヒー", itemName: "コーヒーの機械" }),
    );
  });
});
