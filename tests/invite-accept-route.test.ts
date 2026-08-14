import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleClientMock, rpcMock } = vi.hoisted(() => ({
  createServiceRoleClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/service-role", () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}));

import { NextRequest } from "next/server";

import { GET } from "../app/invitations/accept/route";

describe("招待リンクの交換エントリーポイント(GET /invitations/accept)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceRoleClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("tokenを持つ場合はservice-role経由で交換RPCを呼び、IPアドレスを渡し、claim secretをhttpOnly cookieへ格納してtokenを含まないURLへ303リダイレクトする", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          claim_secret: "a".repeat(64),
          expires_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest("http://localhost/invitations/accept?token=raw-secret-token", {
        headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith("open_invitation_claim", {
      invitation_token: "raw-secret-token",
      p_client_ip: "203.0.113.5",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/invitations/accept/confirm",
    );

    const cookie = response.cookies.get("yamoru_invite_claim");
    expect(cookie?.value).toBe("a".repeat(64));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/invitations/accept");
    expect(cookie?.sameSite).toBe("lax");
  });

  it("tokenを持たない場合は交換RPCを呼ばず、既存のcookieを引き継いだまま確認画面へ進む", async () => {
    const response = await GET(new NextRequest("http://localhost/invitations/accept"));

    expect(rpcMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/invitations/accept/confirm",
    );
    expect(response.cookies.get("yamoru_invite_claim")).toBeUndefined();
  });

  it("交換RPCが失敗した場合もcookieを設定せず同じ確認画面へリダイレクトする(有効・無効で応答を変えない)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("unexpected failure") });

    const response = await GET(
      new NextRequest("http://localhost/invitations/accept?token=raw-secret-token"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/invitations/accept/confirm",
    );
    expect(response.cookies.get("yamoru_invite_claim")).toBeUndefined();
  });

  it("claimの有効期限は30分を超えない", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          claim_secret: "b".repeat(64),
          // 招待自体の残り期限が長くても、cookieのmax-ageは30分でキャップされる。
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest("http://localhost/invitations/accept?token=raw-secret-token"),
    );

    const cookie = response.cookies.get("yamoru_invite_claim");
    expect(cookie?.maxAge).toBeDefined();
    expect(cookie?.maxAge as number).toBeLessThanOrEqual(30 * 60);
  });
});
