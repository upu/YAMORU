import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({ auth: vi.fn() }));

import {
  HouseholdContent,
  type InvitationSummary,
} from "../app/household/page";

afterEach(cleanup);

const PENDING_INVITATION: InvitationSummary = {
  createdAt: "2026-08-14T00:00:00.000Z",
  expiresAt: "2026-08-21T00:00:00.000Z",
  id: "invitation-1",
  invitedEmail: "family@example.test",
  status: "pending",
};

describe("家庭画面(Issue #147)", () => {
  it("ニックネーム未登録なら個人情報の登録を先に案内する", () => {
    render(
      <HouseholdContent
        household={null}
        invitations={[]}
        members={[]}
        nickname={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "ニックネームを登録してください" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "アカウントで登録する" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("ニックネーム登録済みで家庭未所属なら家庭作成フォームを表示する", () => {
    render(
      <HouseholdContent
        household={null}
        invitations={[]}
        members={[]}
        nickname="たろう"
      />,
    );

    const section = screen.getByRole("region", { name: "家庭を作成" });
    expect(within(section).getByLabelText("家庭名")).toHaveValue("たろうの家庭");
    expect(within(section).getByRole("button", { name: "家庭を作成" }))
      .toBeInTheDocument();
  });

  it("家庭名・家族メンバー・招待管理を一つの家庭画面に表示する", () => {
    render(
      <HouseholdContent
        household={{ id: "household-1", name: "テスト家庭" }}
        invitations={[PENDING_INVITATION]}
        members={[
          { nickname: "たろう", userId: "user-1" },
          { nickname: "はなこ", userId: "user-2" },
        ]}
        nickname="たろう"
      />,
    );

    expect(screen.getByText("テスト家庭")).toBeInTheDocument();
    const members = screen.getByRole("region", { name: "家族メンバー" });
    expect(within(members).getByText("たろう")).toBeInTheDocument();
    expect(within(members).getByText("はなこ")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "招待する" })).toBeInTheDocument();
    const invitations = screen.getByRole("region", { name: "発行済みの招待" });
    expect(within(invitations).getByText("family@example.test")).toBeInTheDocument();
    expect(within(invitations).getByRole("button", { name: "取消する" }))
      .toBeInTheDocument();
    expect(within(invitations).getByRole("link", { name: "再発行する" }))
      .toHaveAttribute(
        "href",
        "/household?reissue=family%40example.test#issue-invitation-title",
      );
  });
});
