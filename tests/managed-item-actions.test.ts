import { beforeEach, describe, expect, it, vi } from "vitest";

const { createManagedItemInD1Mock, getD1ContextMock, redirectMock, revalidatePathMock } = vi.hoisted(
  () => ({
    createManagedItemInD1Mock: vi.fn(),
    getD1ContextMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock("../lib/d1/context", () => ({
  getD1Context: getD1ContextMock,
}));

vi.mock("../lib/d1/managed-items", () => ({
  createManagedItem: createManagedItemInD1Mock,
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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createManagedItemInD1Mock.mockResolvedValue("managed-item-id");
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

    expect(createManagedItemInD1Mock).toHaveBeenCalledWith("db", "session", {
      externalUrl: "https://example.com/product",
      kind: "pet_supplies",
      name: "猫の浄水器",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items");
    expect(redirectMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
  });

  it("空の外部リンクはリンクなしとして登録する", async () => {
    await createManagedItem(INITIAL_STATE, managedItemForm());

    expect(createManagedItemInD1Mock).toHaveBeenCalledWith("db", "session", {
      externalUrl: null,
      kind: "pet_supplies",
      name: "猫の浄水器",
    });
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効な名前(%s)はRPCへ送らない",
    async (name) => {
      const result = await createManagedItem(
        INITIAL_STATE,
        managedItemForm({ name }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
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

    expect(getD1ContextMock).not.toHaveBeenCalled();
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

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "外部リンクはhttpまたはhttpsの絶対URLで入力してください。",
      status: "error",
    });
  });

  it("保存失敗の内部詳細を表示せず再試行できる案内を返す", async () => {
    createManagedItemInD1Mock.mockRejectedValue(
      new Error("sensitive database detail"),
    );

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
