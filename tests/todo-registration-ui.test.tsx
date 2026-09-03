import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createTodoMock } = vi.hoisted(() => ({ createTodoMock: vi.fn() }));

vi.mock("../src/app/todos/new/actions", () => ({ createTodo: createTodoMock }));
vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import { TodoRegistrationContent } from "../src/app/todos/new/page";

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
    expect(screen.getByLabelText("一定の間隔で繰り返す")).not.toBeChecked();
    expect(screen.getByLabelText("曜日・日付で繰り返す")).not.toBeChecked();
    expect(screen.getByLabelText("関連する管理対象なし")).toBeChecked();
    expect(screen.getByLabelText("予定日")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("予定日")).not.toBeRequired();
    expect(screen.getByText(/日付がまだ決まっていない場合は、空欄で登録できます。/)).toBeInTheDocument();
    expect(screen.queryByLabelText("最短")).not.toBeInTheDocument();
    // Issue #173: タイムゾーンの説明は家庭ページへ移し、この画面には表示しない。
    expect(screen.queryByText(/タイムゾーン/)).not.toBeInTheDocument();
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
    expect(screen.getByRole("option", { name: "か月後" })).toHaveValue("month");
    expect(screen.getByRole("option", { name: "年後" })).toHaveValue("year");
    expect(screen.getByLabelText("前回実施日")).toHaveAttribute("type", "date");
    expect(screen.queryByLabelText("予定日")).not.toBeInTheDocument();
  });

  it("月・年を選ぶと約10年の単位別上限と暦補正を案内する", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("完了した日から繰り返す"));
    fireEvent.change(screen.getByLabelText("単位"), { target: { value: "month" } });

    expect(screen.getByLabelText("最短")).toHaveAttribute("max", "120");
    expect(screen.getByLabelText("最長")).toHaveAttribute("max", "120");
    expect(screen.getByText(/存在しない日は、その月の月末に合わせます。/u))
      .toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("単位"), { target: { value: "year" } });
    expect(screen.getByLabelText("最短")).toHaveAttribute("max", "10");
    expect(screen.getByLabelText("最長")).toHaveAttribute("max", "10");
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

// Issue #101: 定例日の入力欄は毎週・毎月の2方式・毎年の2方式へ増えたため、
// 他の繰り返し方の表示と分けて確かめる。
describe("Todo登録ページの定例日入力", () => {
  it("定例日基準で毎月を一つの選択肢にまとめ、日付方式と曜日方式を切り替えられる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));

    expect(screen.getByLabelText("定例パターン")).toHaveValue("weekly");
    // Issue #102: 毎週は月〜日を複数選べるチェックボックスにする。
    expect(screen.getByRole("checkbox", { name: "月曜日" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "日曜日" })).not.toBeChecked();
    expect(screen.queryByLabelText("予定日")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("最短")).not.toBeInTheDocument();

    expect(screen.getByRole("option", { name: "毎月" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "毎月の日付" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "毎月の第N曜日" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "monthly" },
    });
    expect(screen.getByLabelText("日付で指定")).toBeChecked();
    const monthlyDayInput = screen.getByLabelText("日付");
    expect(monthlyDayInput).toHaveAttribute("max", "31");
    expect(monthlyDayInput).toHaveAttribute("min", "1");
    expect(monthlyDayInput).toHaveAttribute("inputmode", "numeric");
    expect(monthlyDayInput).toHaveAttribute("step", "1");
    expect(monthlyDayInput).toHaveAccessibleDescription(
      "1〜31の日付を入力してください。存在しない日は、その月の月末に合わせます。",
    );
    expect(screen.getByText("日")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("曜日で指定"));
    expect(screen.getByLabelText("曜日")).toHaveValue("1");
    expect(screen.getByRole("checkbox", { name: "第1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "第5" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "最終" })).not.toBeChecked();
    expect(
      screen.getByText("第5曜日がない月はその月をスキップし、最終は毎月の最後の曜日を選びます。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "第1" }));
    expect(screen.getByText("第1〜第5または最終を1つ以上選んでください。"))
      .toBeInTheDocument();
    for (const label of ["第1", "第2", "第3", "第4", "第5", "最終"]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeRequired();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "最終" }));
    expect(screen.queryByText("第1〜第5または最終を1つ以上選んでください。"))
      .not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "yearly" },
    });
    expect(screen.getByLabelText("月")).toHaveValue("1");
    expect(screen.getByLabelText("日付で指定")).toBeChecked();
    expect(screen.getByLabelText("日付")).toHaveValue(1);
  });

  // Issue #101 / YDR-040の3・4
  it("毎年で曜日を選ぶと、月と同じ出現位置の入力へ切り替える", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));
    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "yearly" },
    });
    fireEvent.click(screen.getByLabelText("曜日で指定"));

    expect(screen.queryByLabelText("日付")).not.toBeInTheDocument();
    expect(screen.getByLabelText("月")).toBeInTheDocument();
    expect(screen.getByLabelText("曜日")).toHaveValue("1");
    expect(screen.getByRole("checkbox", { name: "第1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "最終" })).not.toBeChecked();
    expect(screen.getByText(
      "第5曜日がない年はその年をスキップし、最終は指定した月の最後の曜日を選びます。",
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "第1" }));
    expect(screen.getByText("第1〜第5または最終を1つ以上選んでください。"))
      .toBeInTheDocument();
  });

  // Issue #227 / YDR-032
  it("毎月の日付で「毎月末」を選ぶと日付入力を出さない", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));
    fireEvent.change(screen.getByLabelText("定例パターン"), {
      target: { value: "monthly" },
    });

    expect(screen.getByLabelText("日付を指定")).toBeChecked();
    expect(screen.getByLabelText("日付")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("毎月末"));

    expect(screen.queryByLabelText("日付")).not.toBeInTheDocument();
    expect(
      screen.getByText(/その月の最終日\(1月31日、2月28日\/29日、4月30日など\)を予定日にします。/),
    ).toBeInTheDocument();
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
      target: { value: "monthly" },
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
});

// Issue #102 / YDR-040: 毎週は複数の曜日を選べる。
describe("Todo登録ページの毎週の曜日選択", () => {
  it("毎週で曜日をすべて外すと、入力箇所と関連付いたエラーを表示する", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("曜日・日付で繰り返す"));
    const monday = screen.getByRole("checkbox", { name: "月曜日" });
    const thursday = screen.getByRole("checkbox", { name: "木曜日" });

    fireEvent.click(thursday);
    expect(thursday).toBeChecked();
    expect(screen.queryByText("曜日を1つ以上選んでください。")).not.toBeInTheDocument();

    fireEvent.click(monday);
    fireEvent.click(thursday);

    const error = screen.getByText("曜日を1つ以上選んでください。");
    expect(error).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "曜日" }))
      .toHaveAttribute("aria-errormessage", error.id);
    expect(monday).toBeRequired();
  });
});

// Issue #99 / YDR-037: 固定間隔(N日ごと・N週ごと)の入力欄。
describe("Todo登録ページの一定の間隔", () => {
  // Issue #99 / YDR-037
  it("一定の間隔ではN日ごと・N週ごとと起点日を入力でき、2週は隔週と分かる", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    fireEvent.click(screen.getByLabelText("一定の間隔で繰り返す"));

    // 初期状態は「日ごと」で、回数は例示のプレースホルダだけを表示する。
    const count = screen.getByLabelText("間隔");
    expect(count).toHaveValue(null);
    expect(count).toHaveAttribute("placeholder", "5");
    expect(count).toHaveAttribute("min", "1");
    expect(count).toHaveAttribute("max", "3650");
    expect(count).toHaveAttribute("step", "1");
    expect(screen.getByLabelText("単位")).toHaveValue("day");
    expect(screen.getByText("ごと")).toBeInTheDocument();
    expect(screen.getByText(/起点日から何日ごとに予定するかを入力します。/u))
      .toBeInTheDocument();
    expect(screen.getByLabelText("起点日")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("起点日")).toBeRequired();
    expect(screen.queryByLabelText("予定日")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("最短")).not.toBeInTheDocument();

    fireEvent.change(count, { target: { value: "10" } });

    expect(screen.getByText(/起点日から10日ごとに予定します。/u)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("単位"), { target: { value: "week" } });
    fireEvent.change(count, { target: { value: "2" } });

    expect(screen.getByLabelText("間隔")).toHaveAttribute("max", "520");
    expect(screen.getByText(/起点日から2週間ごと\(隔週\)に予定します。/u))
      .toBeInTheDocument();
  });

  // Issue #99 / YDR-037の8: 完了日基準との違いを選択肢の補足文で示す。
  it("完了日基準と一定の間隔の違いを選択肢の補足文で説明する", () => {
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );

    expect(screen.getByText(/遅れて完了すると、その分だけ次回も後ろへずれます。/u))
      .toBeInTheDocument();
    expect(screen.getByText(/遅れて完了しても周期はずれません。/u))
      .toBeInTheDocument();
  });
});

// Issue #286: 登録直後に、登録できたことと次回の予定・確認先を確かめられる。
describe("Todo登録後の表示", () => {
  function renderAndSubmit(registered: {
    homeNotice: string | null;
    schedule: string;
  } | undefined) {
    createTodoMock.mockImplementation(() =>
      Promise.resolve({ message: "Todoを登録しました。", registered, status: "success" }),
    );
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );
    fireEvent.change(screen.getByLabelText("Todo名"), {
      target: { value: "翌月の予定表を提出する" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Todoを登録" }));
  }

  it("次回の予定と、ホームに表示され始める日・Todo一覧への導線を示す", async () => {
    renderAndSubmit({
      homeNotice:
        "9月8日からホームの「近日」に表示されます。それまではTodo一覧で確認できます。",
      schedule: "次回: 9月15日",
    });

    expect(await screen.findByText("Todoを登録しました。")).toBeInTheDocument();
    expect(screen.getByText("次回: 9月15日")).toBeInTheDocument();
    expect(
      screen.getByText(
        "9月8日からホームの「近日」に表示されます。それまではTodo一覧で確認できます。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登録したTodoを一覧で確認" }))
      .toHaveAttribute("href", "/todos");
  });

  it("ホームへすぐ表示されるTodoでは、表示開始日の案内を重ねない", async () => {
    renderAndSubmit({ homeNotice: null, schedule: "次回: 9月2日" });

    expect(await screen.findByText("次回: 9月2日")).toBeInTheDocument();
    expect(screen.queryByText(/ホームの/u)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登録したTodoを一覧で確認" }))
      .toBeInTheDocument();
  });

  // 保存は成功しているため、次回予定を組み立てられなかった場合でも
  // 登録できたことは伝える(Copilotレビュー指摘)。
  it("次回予定を組み立てられなかった場合も、登録できたことは伝える", async () => {
    renderAndSubmit(undefined);

    expect(await screen.findByText("Todoを登録しました。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "登録したTodoを一覧で確認" }))
      .not.toBeInTheDocument();
  });

  it("登録に失敗したときは予定も導線も出さない", async () => {
    createTodoMock.mockImplementation(() =>
      Promise.resolve({
        message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
        status: "error",
      }),
    );
    render(
      <TodoRegistrationContent
        household={{ id: "household-1", name: "テスト家庭" }}
        initialManagedItemId={null}
        managedItems={ITEMS}
      />,
    );
    fireEvent.change(screen.getByLabelText("Todo名"), { target: { value: "家族会議" } });
    fireEvent.click(screen.getByRole("button", { name: "Todoを登録" }));

    expect(
      await screen.findByText("Todoを登録できませんでした。時間をおいて再度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "登録したTodoを一覧で確認" }))
      .not.toBeInTheDocument();
  });
});
