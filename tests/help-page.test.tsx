import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HelpContent } from "../src/app/help/page";

afterEach(cleanup);

const VERSION_INFO = {
  buildId: "e174985",
  environment: "preview" as const,
  version: "0.8.0",
};

describe("ヘルプの使い方(Issue #361)", () => {
  // Issue #399: 画面では消耗品は台帳の中の一種類なので、Todo・台帳・消耗品を
  // 同列の3概念として並べない。大きな役割はTodo(やること)と台帳(家で管理して
  // おくもの)の2つにする。
  it("大きな役割をTodoと台帳の2つで説明する", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const usage = screen.getByRole("region", { name: "YAMORUの使い方" });
    const terms = within(usage).getAllByRole("term");
    expect(terms.map((term) => term.textContent)).toEqual(["Todo", "台帳"]);
    expect(within(usage).getByText(/^やることです。/u)).toBeInTheDocument();
    expect(within(usage).getByText(/家で管理しておくものです。/u)).toBeInTheDocument();
    expect(within(usage).getByRole("heading", { name: "日常的な操作" }))
      .toBeInTheDocument();
  });

  it("消耗品を、備品・サービス・契約と並ぶ台帳の種類として説明する", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const usage = screen.getByRole("region", { name: "YAMORUの使い方" });
    // 台帳の説明(dd)の中に3種類が入っていて、Todoと同じ階層には出ない。
    const ledgerDetail = within(usage).getByText(/家で管理しておくものです。/u);
    const kinds = within(ledgerDetail).getAllByRole("listitem");
    expect(kinds).toHaveLength(3);
    for (const [kind, term] of [
      [kinds[0], "備品"],
      [kinds[1], "サービス・契約"],
      [kinds[2], "消耗品"],
    ] as const) {
      expect(within(kind).getByText(term)).toBeInTheDocument();
    }
    // 画面(台帳の種類)と同じ用語で、消耗品固有の在庫の扱いもここに残す。
    expect(kinds[2].textContent).toContain("ある / 少ない / ない");
    // YDR-036: サービス・契約は税金や公的支払いも含む大分類なので、契約だけを
    // 挙げて登録できる対象を狭く見せない(詳しい種類は契約・習い事・固定資産税)。
    expect(kinds[1].textContent).toContain("税金");
  });

  it("アイコンだけの操作の意味を、ピン留めを含めて確認できる", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const icons = screen.getByRole("region", { name: "主なアイコン" });
    const pin = within(icons).getByText("ピン留め");
    expect(pin.querySelector("svg")).toBeInTheDocument();
    expect(within(icons).getByText(/ホームのピン留めに追加します/u))
      .toBeInTheDocument();
    expect(within(icons).getByText("追加")).toBeInTheDocument();
    expect(within(icons).getByText("編集")).toBeInTheDocument();
  });

  it("使い方を足しても、問い合わせ用のバージョン情報を残す", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const version = screen.getByRole("region", { name: "バージョン情報" });
    expect(within(version).getByText("YAMORU 0.8.0 · preview · e174985"))
      .toBeInTheDocument();
  });
});
