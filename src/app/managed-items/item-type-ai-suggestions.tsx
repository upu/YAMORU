"use client";

import { useRef, useState } from "react";

import {
  type ItemTypeSuggestionInput,
  suggestItemTypes,
} from "./item-type-suggestion-actions";

// Issue #332: 「詳しい種類」の候補をAIに考えてもらう入力補助。自動では実行せず、
// 利用者が💡を押したときだけ問い合わせる。アイコンは「AIによる生成」よりも
// 「困ったときに候補を考えてくれる」意味を伝えたいため、✨ではなく💡を使う
// (issue本文のUIイメージ)。絵文字だけでは役割が伝わらないため、💡は装飾として
// 読み上げから外し、隣に何をするボタンなのかを文字でも置く。
const SUGGEST_BUTTON_LABEL = "詳しい種類の候補を考えてもらう";
const SUGGESTION_GROUP_LABEL = "考えた詳しい種類の候補から選ぶ";
const READY_MESSAGE = "名前や入力内容から候補を考えました。選ぶと入力欄へ入ります。";

type SuggestionPanelState =
  | { kind: "closed" }
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { kind: "ready"; suggestionId: string; suggestions: string[] };

// 提案の手がかりは、ボタンを押した時点でフォームに入っている値をそのまま使う
// (未入力の項目を待たない、issue本文の「AI提案で利用する情報」)。名前・メモ・
// メーカー情報は同じフォームの別コンポーネントが持つため、状態を持ち上げず
// FormDataとして読み取る。
function readFormContext(
  container: HTMLElement | null,
  values: { currentItemTypeText: string; kindCode: string },
): ItemTypeSuggestionInput {
  const form = container?.closest("form") ?? null;
  const formData = form === null ? new FormData() : new FormData(form);
  const field = (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    currentItemTypeText: values.currentItemTypeText,
    itemName: field("name"),
    kindCode: values.kindCode,
    note: field("note"),
    productInfo: field("productInfo"),
  };
}

function SuggestionList({
  onAdopt,
  onClose,
  suggestions,
}: {
  onAdopt: (label: string) => void;
  onClose: () => void;
  suggestions: string[];
}) {
  return (
    <>
      <div
        aria-label={SUGGESTION_GROUP_LABEL}
        className="managed-item-results custom-item-type-suggestions"
        role="group"
      >
        {suggestions.map((suggestion) => (
          <button
            className="custom-item-type-suggestion"
            key={suggestion}
            onClick={() => { onAdopt(suggestion); }}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <button className="item-type-suggestion-close" onClick={onClose} type="button">
        候補を閉じる
      </button>
    </>
  );
}

function panelMessage(state: SuggestionPanelState): string {
  if (state.kind === "loading") return "候補を考えています…";
  if (state.kind === "error") return state.message;
  return state.kind === "ready" ? READY_MESSAGE : "";
}

export function ItemTypeAiSuggestions({
  currentItemTypeText,
  idPrefix,
  kindCode,
  onAdopt,
}: {
  currentItemTypeText: string;
  idPrefix: string;
  kindCode: string;
  onAdopt: (label: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SuggestionPanelState>({ kind: "closed" });
  const statusId = `${idPrefix}-item-type-suggestion-status`;
  const message = panelMessage(state);

  // 候補を閉じた・AIを使わず登録したときは、提案IDを送らない。採用結果が
  // 記録されないため、「提案したのに採用されなかった」という誤った否定
  // フィードバックにはならない(issue本文の採用結果の表)。
  async function requestSuggestions(): Promise<void> {
    setState({ kind: "loading" });
    const result = await suggestItemTypes(
      readFormContext(containerRef.current, { currentItemTypeText, kindCode }),
    );
    setState(
      result.status === "ok"
        ? {
          kind: "ready",
          suggestionId: result.suggestionId,
          suggestions: result.suggestions,
        }
        : { kind: "error", message: result.message },
    );
  }

  return (
    <div className="item-type-suggestion" ref={containerRef}>
      <button
        aria-describedby={statusId}
        className="item-type-suggestion-trigger"
        disabled={state.kind === "loading"}
        onClick={() => { void requestSuggestions(); }}
        type="button"
      >
        <span aria-hidden="true">💡</span>
        {SUGGEST_BUTTON_LABEL}
      </button>
      {state.kind === "ready" ? (
        <input name="itemTypeSuggestionId" type="hidden" value={state.suggestionId} />
      ) : null}
      {state.kind === "ready" ? (
        <SuggestionList
          onAdopt={onAdopt}
          onClose={() => { setState({ kind: "closed" }); }}
          suggestions={state.suggestions}
        />
      ) : null}
      <p aria-live="polite" className="input-help" id={statusId}>{message}</p>
    </div>
  );
}
