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

const ACCEPTED_INVITATION: InvitationSummary = {
  ...PENDING_INVITATION,
  id: "invitation-2",
  status: "accepted",
};

describe("家族招待画面", () => {
  it("家庭未所属の利用者には招待機能を隠して家庭作成フォームを表示する", () => {
    render(
      <HouseholdContent
        household={null}
        invitations={[]}
        members={[]}
        nickname="たろう"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "家庭を作成" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("招待先メールアドレス")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "家庭を作成" })).toBeInTheDocument();
  });

  it("家庭所属済みなら発行フォームと空状態を表示する", () => {
    render(
      <HouseholdContent
        household={{ id: "household-1", name: "テスト家庭" }}
        invitations={[]}
        members={[]}
        nickname="たろう"
      />,
    );

    const form = screen.getByRole("region", { name: "招待する" });
    expect(within(form).getByLabelText("招待先メールアドレス")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByText("まだ招待はありません。")).toBeInTheDocument();
  });

  it("有効な招待には状態表示と取消・再発行操作を表示する", () => {
    render(
      <HouseholdContent
        household={{ id: "household-1", name: "テスト家庭" }}
        invitations={[PENDING_INVITATION]}
        members={[]}
        nickname="たろう"
      />,
    );

    const list = screen.getByRole("region", { name: "発行済みの招待" });
    expect(within(list).getByText("family@example.test")).toBeInTheDocument();
    expect(within(list).getByText("有効")).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "取消する" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("link", { name: "再発行する" }),
    ).toHaveAttribute(
      "href",
      "/household?reissue=family%40example.test#issue-invitation-title",
    );
  });

  it("受諾済みの招待には取消・再発行操作を表示しない", () => {
    render(
      <HouseholdContent
        household={{ id: "household-1", name: "テスト家庭" }}
        invitations={[ACCEPTED_INVITATION]}
        members={[]}
        nickname="たろう"
      />,
    );

    const list = screen.getByRole("region", { name: "発行済みの招待" });
    expect(within(list).getByText("使用済み")).toBeInTheDocument();
    expect(
      within(list).queryByRole("button", { name: "取消する" }),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByRole("link", { name: "再発行する" }),
    ).not.toBeInTheDocument();
  });

  it("reissueクエリのメールを発行フォームへ引き継ぐ", () => {
    render(
      <HouseholdContent
        defaultInviteEmail="reissue-me@example.test"
        household={{ id: "household-1", name: "テスト家庭" }}
        invitations={[]}
        members={[]}
        nickname="たろう"
      />,
    );

    expect(screen.getByLabelText("招待先メールアドレス")).toHaveValue(
      "reissue-me@example.test",
    );
  });
});
