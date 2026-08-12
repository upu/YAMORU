import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, redirectMock, revalidatePathMock, rpcMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    rpcMock: vi.fn(),
  }),
);

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { createManagedItem } from "../app/managed-items/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function managedItemForm({
  externalUrl = "",
  kind = "pet_supplies",
  name = "猫の浄水器",
}: {
  externalUrl?: string;
  kind?: string;
  name?: string;
} = {}) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("kind", kind);
  formData.set("externalUrl", externalUrl);
  return formData;
}

describe("ManagedItem登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "managed-item-id", error: null });
  });

  it("家庭IDを受け取らず、整形済み入力を限定RPCへ渡す", async () => {
    await createManagedItem(
      INITIAL_STATE,
      managedItemForm({
        externalUrl: "  https://example.com/product  ",
        kind: "pet_supplies",
        name: "  猫の浄水器  ",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_managed_item", {
      external_url: "https://example.com/product",
      item_kind: "pet_supplies",
      item_name: "猫の浄水器",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items");
    expect(redirectMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
  });

  it("空の外部リンクはリンクなしとして登録する", async () => {
    await createManagedItem(INITIAL_STATE, managedItemForm());

    // 引数を省くとSQL関数側の`default null`が使われ、リンクなしになる。
    expect(rpcMock).toHaveBeenCalledWith("create_managed_item", {
      external_url: undefined,
      item_kind: "pet_supplies",
      item_name: "猫の浄水器",
    });
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効な名前(%s)はRPCへ送らない",
    async (name) => {
      const result = await createManagedItem(
        INITIAL_STATE,
        managedItemForm({ name }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "名前は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("未定義の種類はRPCへ送らない", async () => {
    const result = await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ kind: "secret_kind" }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "種類を選択してください。",
      status: "error",
    });
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/file",
    "/relative/path",
    "https://",
  ])("http/httpsの絶対URLではない入力(%s)を拒否する", async (externalUrl) => {
    const result = await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ externalUrl }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "外部リンクはhttpまたはhttpsの絶対URLで入力してください。",
      status: "error",
    });
  });

  it("保存失敗の内部詳細を表示せず再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ externalUrl: "https://example.com/product" }),
    );

    expect(result).toEqual({
      message: "管理対象を登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
