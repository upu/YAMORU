import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FloatingAddButton } from "../src/app/floating-add-button";

afterEach(cleanup);

describe("共通の追加ボタン(Issue #215)", () => {
  it("ホームとTodo画面ではTodo登録をアクセシブルな名前で開く", () => {
    render(<FloatingAddButton destination="todo" />);

    const link = screen.getByRole("link", { name: "Todoを追加" });
    expect(link).toHaveAttribute("href", "/todos/new");
    expect(link).toHaveAttribute("title", "Todoを追加");
    expect(link).toHaveTextContent("＋");
    expect(link).not.toHaveTextContent("⊕");
  });

  it("台帳画面では管理対象登録を台帳向けの名前で開く", () => {
    render(<FloatingAddButton destination="managed-item" />);

    const link = screen.getByRole("link", { name: "台帳に追加" });
    expect(link).toHaveAttribute("href", "/managed-items/new");
    expect(link).toHaveAttribute("title", "台帳に追加");
    expect(link).toHaveTextContent("＋");
    expect(link).not.toHaveTextContent("⊕");
  });
});
