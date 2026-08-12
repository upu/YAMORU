import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoStateProvider } from "../app/demo-state";
import Home from "../app/page";
import ManagedItemDetail from "../app/managed-items/cat-water-fountain/page";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 12, 10, 30));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("フィルター交換Todoの完了フロー", () => {
  it("追加入力なしで完了し、ホームと詳細画面へ結果を反映する", () => {
    const view = render(
      <DemoStateProvider>
        <Home />
      </DemoStateProvider>,
    );

    const openCompletionButton = screen.getByRole("button", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    expect(openCompletionButton).toHaveTextContent("やったよ");

    fireEvent.click(openCompletionButton);

    const dialog = screen.getByRole("dialog", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    expect(within(dialog).getByRole("button", { name: "今、自分がやった" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "詳しく記録する" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("対応状況")).toHaveTextContent(
      "4件の予定1件が期限切れ",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "今、自分がやった" }));

    const completionFeedback = screen.getByRole("status");
    expect(completionFeedback).toHaveTextContent(
      "フィルター交換を記録しました",
    );
    expect(completionFeedback).toHaveFocus();
    expect(screen.getByLabelText("対応状況")).toHaveTextContent(
      "3件の予定0件が期限切れ",
    );
    expect(
      within(screen.getByRole("region", { name: "期限切れ" })).queryByRole(
        "button",
        { name: "猫の浄水器のフィルター交換を記録" },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "最近の実施" })).getByText(
        "8月12日 ・ 家族Aが実施",
      ),
    ).toBeInTheDocument();

    view.rerender(
      <DemoStateProvider>
        <ManagedItemDetail />
      </DemoStateProvider>,
    );

    const lastActivity = screen.getByRole("region", {
      name: "最後のフィルター交換",
    });
    expect(within(lastActivity).getByText("8月12日")).toBeInTheDocument();
    expect(within(lastActivity).getByText("家族A")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "関連するTodo" })).getByText(
        "9月11日まで",
      ),
    ).toBeInTheDocument();
  });

  it("必要な場合だけ実施日を指定し、その日から次回期限を計算する", () => {
    const view = render(
      <DemoStateProvider>
        <Home />
      </DemoStateProvider>,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "猫の浄水器のフィルター交換を記録",
    }));
    const dialog = screen.getByRole("dialog", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "詳しく記録する" }));

    const occurredOnInput = within(dialog).getByLabelText("実施日");
    expect(occurredOnInput).toHaveAttribute("type", "date");
    expect(occurredOnInput).toHaveAttribute("max", "2026-08-12");
    fireEvent.change(occurredOnInput, {
      target: { value: "2026-08-10" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "この内容で記録する" }),
    );

    expect(
      within(screen.getByRole("region", { name: "最近の実施" })).getByText(
        "8月10日 ・ 家族Aが実施",
      ),
    ).toBeInTheDocument();

    view.rerender(
      <DemoStateProvider>
        <ManagedItemDetail />
      </DemoStateProvider>,
    );

    const lastActivity = screen.getByRole("region", {
      name: "最後のフィルター交換",
    });
    expect(within(lastActivity).getByText("8月10日")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "関連するTodo" })).getByText(
        "9月9日まで",
      ),
    ).toBeInTheDocument();
  });

  it("主要操作を支援技術から名前で識別できる", () => {
    render(
      <DemoStateProvider>
        <Home />
      </DemoStateProvider>,
    );

    const openCompletionButton = screen.getByRole("button", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    fireEvent.click(openCompletionButton);

    const dialog = screen.getByRole("dialog", {
      name: "猫の浄水器のフィルター交換を記録",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "閉じる" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(openCompletionButton).toHaveFocus();
  });
});
