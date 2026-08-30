import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  loadAccountStateMock,
  loadActorNameMock,
  loadHouseholdMembersMock,
  listPendingOccurrencesMock,
  listRecentActiveCompletionsMock,
  listShoppingCandidatesMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  loadActorNameMock: vi.fn(),
  loadHouseholdMembersMock: vi.fn(),
  listPendingOccurrencesMock: vi.fn(),
  listRecentActiveCompletionsMock: vi.fn(),
  listShoppingCandidatesMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/home", () => ({
  listPendingOccurrences: listPendingOccurrencesMock,
  listRecentActiveCompletions: listRecentActiveCompletionsMock,
}));
vi.mock("../src/lib/d1/consumables", () => ({
  listShoppingCandidates: listShoppingCandidatesMock,
}));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  FALLBACK_SELF_ACTOR_NAME: "あなた",
  loadActorName: loadActorNameMock,
  loadHouseholdMembers: loadHouseholdMembersMock,
  loadProfileNames: vi.fn().mockResolvedValue(new Map()),
}));

import Home from "../src/app/page";

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
});

afterEach(cleanup);

describe("ホーム画面(Home、サーバーコンポーネント)", () => {
  it("家庭未所属の利用者では家庭作成を案内し、家庭専用データの取得を呼ばない(Issue #144回帰)", async () => {
    loadAccountStateMock.mockResolvedValue({ household: null, nickname: null });

    const element = await Home();
    render(element);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    // 家庭未所属だとrequireCurrentHouseholdIdが例外を投げるため、
    // これらは家庭所属チェックより後に呼ばれてはならない。
    expect(loadActorNameMock).not.toHaveBeenCalled();
    expect(loadHouseholdMembersMock).not.toHaveBeenCalled();
    expect(listPendingOccurrencesMock).not.toHaveBeenCalled();
    expect(listRecentActiveCompletionsMock).not.toHaveBeenCalled();
    expect(listShoppingCandidatesMock).not.toHaveBeenCalled();
  });

  it("家庭所属済みの利用者ではホーム内容を表示する", async () => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue([
      { nickname: "ぽっぷ", userId: "user-1" },
    ]);
    listPendingOccurrencesMock.mockResolvedValue([]);
    listRecentActiveCompletionsMock.mockResolvedValue([]);
    listShoppingCandidatesMock.mockResolvedValue([]);

    const element = await Home();
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "ホーム" })).toHaveClass("sr-only");
    expect(screen.queryByText("HOME CARE")).not.toBeInTheDocument();
    expect(screen.queryByText("暮らしの「いつだっけ？」をなくす。"))
      .not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "いま対応することはありません" }),
    ).toBeInTheDocument();
  });

  it("家庭の買い物候補をホームへ表示する", async () => {
    loadAccountStateMock.mockResolvedValue({
      household: { id: "household-1", name: "テスト家庭" },
      nickname: "ぽっぷ",
    });
    loadActorNameMock.mockResolvedValue("ぽっぷ");
    loadHouseholdMembersMock.mockResolvedValue([]);
    listPendingOccurrencesMock.mockResolvedValue([]);
    listRecentActiveCompletionsMock.mockResolvedValue([]);
    listShoppingCandidatesMock.mockResolvedValue([
      { id: "paper", name: "トイレットペーパー", stockStatus: "low" },
    ]);

    render(await Home());

    expect(screen.getByRole("heading", { name: "買っておきたいもの" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "トイレットペーパー" }))
      .toHaveAttribute("href", "/consumables/paper");
    expect(screen.queryByRole("heading", { name: "いま対応することはありません" }))
      .not.toBeInTheDocument();
  });
});
