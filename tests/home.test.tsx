import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "../app/page";
import { DemoStateProvider } from "../app/demo-state";
import { HOME_SECTIONS } from "../app/home-data";

afterEach(cleanup);

function renderHome() {
  return render(<DemoStateProvider><Home /></DemoStateProvider>);
}

describe("ホーム画面", () => {
  it("YAMORUの名前とタグラインを表示する", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: "YAMORU" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("暮らしの「いつだっけ？」をなくす。"),
    ).toBeInTheDocument();
  });

  it("右上からアカウント画面へ移動できる", () => {
    renderHome();

    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("link", { name: "アカウントを開く" }),
    ).toHaveAttribute("href", "/account");
  });

  it.each(["期限切れ", "今日", "そろそろ", "近日", "最近の実施"])(
    "%sの区分を見分けられる",
    (sectionTitle) => {
      renderHome();

      const section = screen.getByRole("region", { name: sectionTitle });
      expect(
        within(section).getByRole("heading", {
          level: 2,
          name: sectionTitle,
        }),
      ).toBeInTheDocument();
    },
  );

  it("猫の浄水器のフィルター交換の期限または実施を表示する", () => {
    renderHome();

    expect(
      screen.getAllByText("猫の浄水器のフィルター交換").length,
    ).toBeGreaterThan(0);
  });

  it("猫の浄水器に関係する表示から管理対象の詳細へ移動できる", () => {
    renderHome();

    const detailLinks = screen.getAllByRole("link", {
      name: "猫の浄水器のフィルター交換",
    });

    expect(detailLinks.length).toBeGreaterThan(0);
    expect(
      detailLinks.every(
        (link) =>
          link.getAttribute("href") ===
          "/managed-items/cat-water-fountain",
      ),
    ).toBe(true);
  });

  it("外部サービスに依存しない固定サンプルを5区分に持つ", () => {
    // overdue/reminderは、猫の浄水器のフィルター交換Todoを推奨期間の
    // 状態(YDR-017)に応じて実行時に差し込むため、固定サンプルとしては空。
    expect(HOME_SECTIONS).toHaveLength(5);
    expect(
      HOME_SECTIONS.filter(
        (section) => section.id !== "overdue" && section.id !== "reminder",
      ).every((section) => section.items.length > 0),
    ).toBe(true);
  });
});

describe("推奨期間による表示(YDR-017)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("推奨期間内は「そろそろ」区分に中立的に表示する", () => {
    // 前回実施(7月10日)から4週間後(8月7日)〜8週間後(9月4日)が推奨期間。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 10, 30));
    renderHome();

    const reminderSection = screen.getByRole("region", { name: "そろそろ" });
    const filterCard = within(reminderSection)
      .getByText("猫の浄水器のフィルター交換")
      .closest("article");
    expect(filterCard).not.toBeNull();
    expect(within(filterCard as HTMLElement).getByText("そろそろ")).toBeInTheDocument();
    expect(
      within(reminderSection).getByText("9月4日までが交換の目安です"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("対応状況")).toHaveTextContent(
      "0件が期限切れ",
    );
  });

  it("推奨期間の上限を超えても厳密な「期限切れ」区分には入れず、責めずに強く案内する", () => {
    // 9月4日が推奨上限。9月10日は上限超過(past-window)。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 10, 30));
    renderHome();

    const reminderSection = screen.getByRole("region", { name: "そろそろ" });
    expect(within(reminderSection).getByText("要確認")).toBeInTheDocument();
    expect(
      within(reminderSection).getByText(
        "9月4日に交換推奨期間の上限を過ぎました",
      ),
    ).toBeInTheDocument();

    const overdueSection = screen.getByRole("region", { name: "期限切れ" });
    expect(
      within(overdueSection).queryByText("猫の浄水器のフィルター交換"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("対応状況")).toHaveTextContent(
      "0件が期限切れ",
    );
  });

  it("推奨期間前はどの予定区分にも表示せず、交換を急かさない", () => {
    // 8月7日が推奨開始。8月1日はまだ推奨期間前(before-window)。
    // 「最近の実施」の履歴表示(過去の完了)とは区別する。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 10, 30));
    renderHome();

    for (const sectionName of ["期限切れ", "今日", "そろそろ", "近日"]) {
      const section = screen.getByRole("region", { name: sectionName });
      expect(
        within(section).queryByText("猫の浄水器のフィルター交換"),
      ).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("対応状況")).toHaveTextContent(
      "0件が期限切れ",
    );
  });
});
