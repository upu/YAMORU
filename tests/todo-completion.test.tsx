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

    fireEvent.click(screen.getByRole("button", { name: "フィルター交換を完了" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "フィルター交換を完了しました",
    );
    expect(
      within(screen.getByRole("region", { name: "期限切れ" })).queryByRole(
        "button",
        { name: "フィルター交換を完了" },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "最近の実施" })).getByText(
        "8月12日 10:30 ・ 家族Aが実施",
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
    expect(within(lastActivity).getByText("8月12日 10:30")).toBeInTheDocument();
    expect(within(lastActivity).getByText("家族A")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "関連するTodo" })).getByText(
        "9月11日まで",
      ),
    ).toBeInTheDocument();
  });

  it("必要な場合だけ実施日時を指定し、その日時から次回期限を計算する", () => {
    const view = render(
      <DemoStateProvider>
        <Home />
      </DemoStateProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "実施日時を変更" }));
    fireEvent.change(screen.getByLabelText("実施日時"), {
      target: { value: "2026-08-10T14:30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "指定した日時で完了" }),
    );

    expect(
      within(screen.getByRole("region", { name: "最近の実施" })).getByText(
        "8月10日 14:30 ・ 家族Aが実施",
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
    expect(within(lastActivity).getByText("8月10日 14:30")).toBeInTheDocument();
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

    expect(
      screen.getByRole("button", { name: "フィルター交換を完了" }),
    ).toBeInTheDocument();
    const changeDateButton = screen.getByRole("button", {
      name: "実施日時を変更",
    });
    expect(changeDateButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(changeDateButton);

    expect(changeDateButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("実施日時")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(
      screen.getByRole("button", { name: "指定した日時で完了" }),
    ).toBeInTheDocument();

    fireEvent.click(changeDateButton);

    expect(changeDateButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("実施日時")).not.toBeInTheDocument();
  });
});
