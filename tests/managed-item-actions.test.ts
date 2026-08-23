import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createManagedItemInD1Mock,
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateManagedItemInD1Mock,
} = vi.hoisted(
  () => ({
    createManagedItemInD1Mock: vi.fn(),
    getD1ContextMock: vi.fn(),
    redirectMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    updateManagedItemInD1Mock: vi.fn(),
  }),
);

vi.mock("../lib/d1/context", () => ({
  getD1Context: getD1ContextMock,
}));

vi.mock("../lib/d1/managed-items", () => ({
  createManagedItem: createManagedItemInD1Mock,
  updateManagedItem: updateManagedItemInD1Mock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { createManagedItem, updateManagedItem } from "../app/managed-items/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function managedItemForm({
  customItemType = "",
  externalUrl = "",
  itemTypeCode = "appliance",
  kindCode = "asset",
  name = "猫の浄水器",
}: {
  customItemType?: string;
  externalUrl?: string;
  itemTypeCode?: string;
  kindCode?: string;
  name?: string;
} = {}) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("kindCode", kindCode);
  formData.set("itemTypeCode", itemTypeCode);
  formData.set("customItemType", customItemType);
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
        itemTypeCode: "pet_supplies",
        kindCode: "asset",
        name: "  猫の浄水器  ",
      }),
    );

    expect(createManagedItemInD1Mock).toHaveBeenCalledWith("db", "session", {
      customItemType: null,
      externalUrl: "https://example.com/product",
      itemTypeCode: "pet_supplies",
      kindCode: "asset",
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
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
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

  it("大分類が未選択ならD1へ送らない", async () => {
    const result = await createManagedItem(
      INITIAL_STATE,
      managedItemForm({ kindCode: "" }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "大分類を選択してください。",
      status: "error",
    });
  });

  it("自由入力の詳しい種類を整形してD1へ渡す", async () => {
    await createManagedItem(
      INITIAL_STATE,
      managedItemForm({
        customItemType: "  猫用給水機  ",
        itemTypeCode: "__custom__",
      }),
    );

    expect(createManagedItemInD1Mock).toHaveBeenCalledWith("db", "session", {
      customItemType: "猫用給水機",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "猫の浄水器",
    });
  });

  it.each(["", " ", "あ".repeat(51)])(
    "自由入力を選んだとき無効な詳しい種類(%s)はD1へ送らない",
    async (customItemType) => {
      const result = await createManagedItem(
        INITIAL_STATE,
        managedItemForm({ customItemType, itemTypeCode: "__custom__" }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "詳しい種類は1文字以上50文字以内で入力してください。",
        status: "error",
      });
    },
  );

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

function managedItemEditForm({
  customItemType = "",
  externalUrl = "",
  id = "managed-item-id",
  itemTypeCode = "appliance",
  kindCode = "asset",
  name = "猫の浄水器",
}: {
  customItemType?: string;
  externalUrl?: string;
  id?: string;
  itemTypeCode?: string;
  kindCode?: string;
  name?: string;
} = {}) {
  const formData = managedItemForm({
    customItemType,
    externalUrl,
    itemTypeCode,
    kindCode,
    name,
  });
  formData.set("id", id);
  return formData;
}

describe("ManagedItem編集操作(Issue #40)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateManagedItemInD1Mock.mockResolvedValue(undefined);
  });

  it("隠しフィールドのIDと整形済み入力をD1関数へ渡し、両画面を再検証してから詳細へ戻す", async () => {
    await updateManagedItem(
      INITIAL_STATE,
      managedItemEditForm({
        externalUrl: "  https://example.com/updated  ",
        id: "managed-item-id",
        itemTypeCode: "appliance",
        kindCode: "asset",
        name: "  猫の浄水器2  ",
      }),
    );

    expect(updateManagedItemInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "managed-item-id",
      {
        customItemType: null,
        externalUrl: "https://example.com/updated",
        itemTypeCode: "appliance",
        kindCode: "asset",
        name: "猫の浄水器2",
      },
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items");
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
    expect(redirectMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
  });

  it("空の外部リンクは未設定としてD1へ渡す", async () => {
    await updateManagedItem(INITIAL_STATE, managedItemEditForm());

    expect(updateManagedItemInD1Mock).toHaveBeenCalledWith(
      "db",
      "session",
      "managed-item-id",
      {
        customItemType: null,
        externalUrl: null,
        itemTypeCode: "appliance",
        kindCode: "asset",
        name: "猫の浄水器",
      },
    );
  });

  it("IDのない送信はD1へ送らない", async () => {
    const formData = managedItemForm();

    const result = await updateManagedItem(INITIAL_STATE, formData);

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "管理対象を特定できませんでした。",
      status: "error",
    });
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効な名前(%s)はD1へ送らない",
    async (name) => {
      const result = await updateManagedItem(
        INITIAL_STATE,
        managedItemEditForm({ name }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "名前は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it("家庭Bの管理対象など見つからない対象への更新は内部詳細を表示しない", async () => {
    updateManagedItemInD1Mock.mockRejectedValue(new Error("管理対象が見つかりません。"));

    const result = await updateManagedItem(INITIAL_STATE, managedItemEditForm());

    expect(result).toEqual({
      message: "管理対象を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
