import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/oauth/authorize/actions", () => ({ decideAuthorization: vi.fn() }));
vi.mock("../src/app/settings/integrations/actions", () => ({ revokeConnectionAction: vi.fn() }));

import { AuthorizationErrorCard, ConsentCard } from "../src/app/oauth/authorize/consent-card";
import { ConnectionList } from "../src/app/settings/integrations/connection-list";
import type { ConnectionSummary } from "../src/lib/d1/oauth-connection-list";

afterEach(cleanup);

const CLIENT_ID = "https://client.example.test/oauth/client.json";

const ACTIVE: ConnectionSummary = {
  clientId: CLIENT_ID,
  clientName: "Example Assistant",
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
  householdName: "架空の家",
  id: "connection-1",
  lastUsedAt: null,
  revokedAt: null,
  revokedReason: null,
  scopes: "household.read household.write",
  status: "active",
};

describe("同意画面", () => {
  function renderConsent(requestedScopes: ("household.read" | "household.write" | "events.subscribe")[]) {
    render(
      <ConsentCard
        client={{
          clientName: "Example Assistant",
          clientUri: null,
          id: CLIENT_ID,
          metadataFetchedAt: "2026-10-17T00:00:00.000Z",
          redirectUris: ["https://client.example.test/callback"],
        }}
        email="family@example.test"
        householdName="架空の家"
        rawRequest="client_id=x"
        request={{
          clientId: CLIENT_ID,
          codeChallenge: "c".repeat(43),
          redirectUri: "https://client.example.test/callback",
          requestedScopes,
          resource: "https://yamoru.example.test/mcp",
          state: null,
        }}
      />,
    );
  }

  it("接続元の名前と確かめられるホスト名、家庭、アカウントを表示する", () => {
    renderConsent(["household.read"]);
    expect(screen.getByRole("heading", { name: /Example Assistantに/u })).toBeInTheDocument();
    expect(screen.getByText("Example Assistant(client.example.test)")).toBeInTheDocument();
    expect(screen.getByText("架空の家")).toBeInTheDocument();
    expect(screen.getByText("family@example.test")).toBeInTheDocument();
  });

  it("要求された範囲だけを選べ、読み取りは外せない", () => {
    renderConsent(["household.read", "household.write", "events.subscribe"]);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /家庭のデータを読む/u })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /家庭のデータを変更する/u })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /通知設定を管理する/u })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /通知を受け取る/u })).toHaveAccessibleName(/通知設定の変更はできません/u);
  });

  it("許可と拒否の両方を選べる", () => {
    renderConsent(["household.read"]);
    expect(screen.getByRole("button", { name: "許可する" })).toHaveAttribute("value", "approve");
    expect(screen.getByRole("button", { name: "許可しない" })).toHaveAttribute("value", "deny");
  });

  it("未許可の接続元は、その理由だけを表示する", () => {
    render(<AuthorizationErrorCard error="invalid_client" />);
    expect(screen.getByRole("alert")).toHaveTextContent("連携を許可されていません");
  });
});

describe("外部サービスとの連携の管理", () => {
  it("連携が無ければその旨を表示する", () => {
    render(<ConnectionList connections={[]} />);
    expect(screen.getByText("連携している外部サービスはありません。")).toBeInTheDocument();
  });

  it("接続先・家庭・許可範囲・状態を表示し、解除できる", () => {
    render(<ConnectionList connections={[ACTIVE]} />);
    const name = screen.getByText("Example Assistant(client.example.test)");
    const item = name.closest("li");
    if (item === null) throw new Error("接続の行がありません");
    expect(within(item).getByText("連携中")).toBeInTheDocument();
    expect(within(item).getByText("架空の家")).toBeInTheDocument();
    expect(within(item).getByText("まだ使われていません")).toBeInTheDocument();
    const scopes = within(item).getByRole("list", { name: "許可している範囲" });
    expect(within(scopes).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["家庭のデータを読む", "家庭のデータを変更する"]);
    expect(within(item).getByRole("button", { name: "Example Assistantとの連携を解除する" })).toBeInTheDocument();
  });

  it("解除済みの接続は理由と再連携の方法を示し、解除ボタンを出さない", () => {
    render(<ConnectionList connections={[{
      ...ACTIVE,
      householdName: null,
      revokedAt: "2026-10-10T00:00:00.000Z",
      revokedReason: "membership_changed",
      status: "revoked",
    }]} />);
    expect(screen.getByText("解除済み")).toBeInTheDocument();
    expect(screen.getByText(/家庭から離れたため、自動で解除しました/u)).toBeInTheDocument();
    expect(screen.getByText(/改めて連携してください/u)).toBeInTheDocument();
    expect(screen.getByText("(現在は所属していない家庭)")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("期限切れの接続は再連携を案内し、解除もできる", () => {
    render(<ConnectionList connections={[{ ...ACTIVE, status: "expired" }]} />);
    expect(screen.getByText("期限切れ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /連携を解除する/u })).toBeInTheDocument();
  });
});
