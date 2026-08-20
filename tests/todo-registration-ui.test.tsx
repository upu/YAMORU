import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createTodoMock } = vi.hoisted(() => ({ createTodoMock: vi.fn() }));

vi.mock("../app/todos/new/actions", () => ({ createTodo: createTodoMock }));
vi.mock("../auth", () => ({ auth: vi.fn() }));

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
    expect(screen.getByLabelText("曜日・日付で繰り返す")).not.toBeChecked();
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

  it("定例日基準で週次・月次日付・月次第N曜日・年次を構造化して選べる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));

    expect(screen.getByLabelText("定例パターン")).toHaveValue("weekly");
    expect(screen.getByLabelText("曜日")).toHaveValue("1");
    expect(screen.queryByLabelText("予定日")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("最短")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "monthly_day" },
    });
    const monthlyDayInput = screen.getByLabelText("日付");
    expect(monthlyDayInput).toHaveAttribute("max", "31");
    expect(monthlyDayInput).toHaveAttribute("min", "1");
    expect(monthlyDayInput).toHaveAttribute("inputmode", "numeric");
    expect(monthlyDayInput).toHaveAttribute("step", "1");
    expect(monthlyDayInput).toHaveAccessibleDescription(
      "1〜31の日付を入力してください。存在しない日は、その月の月末に合わせます。",
    );
    expect(screen.getByText("日")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "monthly_nth_weekday" },
    });
    expect(screen.getByLabelText("第何週")).toHaveValue("1");
    expect(screen.getByLabelText("曜日")).toHaveValue("1");
    expect(
      screen.getByText("第5曜日がない月は、その月をスキップします。"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "yearly" },
    });
    expect(screen.getByLabelText("月")).toHaveValue("1");
    expect(screen.getByLabelText("日付")).toHaveValue(1);
  });

  it("毎月の日付が範囲外なら入力欄の近くに関連付いたエラーを表示する", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));
    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "monthly_day" },
    });
    const dayInput = screen.getByLabelText("日付");

    fireEvent.change(dayInput, { target: { value: "32" } });
    fireEvent.blur(dayInput);

    expect(dayInput).toHaveAttribute("aria-invalid", "true");
    expect(dayInput).toHaveAccessibleErrorMessage("1〜31の整数で入力してください。");
    expect(screen.getByRole("alert")).toHaveTextContent("1〜31の整数で入力してください。");

    fireEvent.change(dayInput, { target: { value: "31" } });
    fireEvent.blur(dayInput);

    expect(dayInput).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
