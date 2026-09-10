import { screen } from "@testing-library/react";

// Issue #390: Todo一覧の担当の絞り込みボタン(summary)は、長い家族名を省略
// 表示するために値だけを別の要素に持つ。文字列が複数要素に分かれるため、
// 既定のgetByTextでは取れない。summary全体の文字列で取る。
export function getAssigneeToggle(label: string): HTMLElement {
  return screen.getByText(
    (_content, element) => element?.tagName === "SUMMARY" && element.textContent === label,
  );
}
