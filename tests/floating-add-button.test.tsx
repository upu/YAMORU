import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FloatingAddButton } from "../src/app/floating-add-button";
import floatingAddButtonStyles from "../src/app/floating-add-button.module.css";

afterEach(cleanup);

describe("共通の追加ボタン(Issue #215)", () => {
  it("行き先と名前を渡したとおりに、アクセシブルな名前と記号で開く", () => {
    render(<FloatingAddButton href="/todos/new" label="Todoを追加" />);

    const link = screen.getByRole("link", { name: "Todoを追加" });
    expect(link).toHaveAttribute("href", "/todos/new");
    expect(link).toHaveAttribute("title", "Todoを追加");
    expect(link).toHaveTextContent("＋");
    expect(link).not.toHaveTextContent("⊕");
  });

  it("Issue #391: 一覧の追加リンクと同じ文言をそのまま使う", () => {
    render(<FloatingAddButton href="/consumables/new" label="消耗品を登録" />);

    const link = screen.getByRole("link", { name: "消耗品を登録" });
    expect(link).toHaveAttribute("href", "/consumables/new");
    expect(link).toHaveAttribute("title", "消耗品を登録");
  });

  // Issue #391: 一覧では、モバイル幅だけこのボタンを主要導線にする。実際の
  // 表示切り替えはmedia queryで行うため、ここではその目印が付くことを確かめ、
  // 幅ごとの見え方はe2e/floating-add-button.spec.tsで確認する。
  it("mobileOnlyを指定すると、ボタンと下端の余白の両方に目印が付く", () => {
    const { container } = render(
      <FloatingAddButton href="/managed-items/new" label="備品を登録" mobileOnly />,
    );

    expect(screen.getByRole("link", { name: "備品を登録" }))
      .toHaveClass(floatingAddButtonStyles.mobileOnly);
    expect(container.querySelector(`.${floatingAddButtonStyles.space}`))
      .toHaveClass(floatingAddButtonStyles.mobileOnly);
  });

  it("mobileOnlyを指定しなければ、どの幅でも出す(ホーム)", () => {
    render(<FloatingAddButton href="/todos/new" label="Todoを追加" />);

    expect(screen.getByRole("link", { name: "Todoを追加" }))
      .not.toHaveClass(floatingAddButtonStyles.mobileOnly);
  });
});
