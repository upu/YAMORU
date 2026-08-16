import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createTodoMock } = vi.hoisted(() => ({ createTodoMock: vi.fn() }));

vi.mock("../app/todos/new/actions", () => ({ createTodo: createTodoMock }));

import { TodoRegistrationContent } from "../app/todos/new/page";

afterEach(cleanup);

const ITEMS = [
  { id: "item-1", name: "猫の浄水器" },
  { id: "item-2", name: "コーヒーマシーン" },
  { id: "item-3", name: "空気清浄機" },
];

describe("Todo登録ページ", () => {
  it("繰り返しなし・管理対象なしを既定にし、ホームへ戻れる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Todoを追加" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ホームへ戻る/ })).toHaveAttribute("href", "/");
    expect(screen.getByLabelText("繰り返しなし")).toBeChecked();
    expect(screen.getByLabelText("完了した日から繰り返す")).not.toBeChecked();
    expect(screen.getByLabelText("関連する管理対象なし")).toBeChecked();
    expect(screen.getByLabelText("予定日")).toHaveAttribute("type", "date");
    expect(screen.queryByLabelText("最短")).not.toBeInTheDocument();
  });

  it("名前で絞り込み、関連する管理対象を選べる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    expect(screen.queryByLabelText("コーヒーマシーン")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "管理対象を検索" }), {
      target: { value: "コーヒー" },
    });

    const results = screen.getByRole("group", { name: "検索結果" });
    expect(within(results).getByLabelText("コーヒーマシーン")).toBeInTheDocument();
    expect(within(results).queryByLabelText("猫の浄水器")).not.toBeInTheDocument();
    fireEvent.click(within(results).getByLabelText("コーヒーマシーン"));
    expect(within(results).getByLabelText("コーヒーマシーン")).toBeChecked();
  });

  it("完了日基準を選ぶと周期と初回の入力へ切り替わる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("完了した日から繰り返す"));

    expect(screen.getByLabelText("最短")).toHaveValue(1);
    expect(screen.getByLabelText("最長")).toHaveValue(2);
    expect(screen.getByLabelText("単位")).toHaveValue("week");
    expect(screen.getByLabelText("前回実施日")).toHaveAttribute("type", "date");
    expect(screen.queryByLabelText("予定日")).not.toBeInTheDocument();
  });

  it("管理対象詳細から来た場合はその管理対象を選んだ状態にする", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId="item-1"
        managedItems={ITEMS}
      />,
    );

    expect(screen.getByLabelText("猫の浄水器")).toBeChecked();
  });

  it("家庭未所属なら登録フォームを出さず、家庭作成を案内する", () => {
    render(
      <TodoRegistrationContent
        household={null}
        initialManagedItemId={null}
        managedItems={[]}
      />,
    );

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });
});
