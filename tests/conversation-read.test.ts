import { describe, expect, it } from "vitest";
import { createReadCursor, cursorScope } from "../src/features/integration/read-cursor";
import { kindInput, limitInput, matchEntity, normalizeEntityText, objectInput } from "../src/features/integration/read-contract";

describe("会話読み取りの入力とcursor", () => {
  it("別名・文字種の揺れを扱い、記号を検索演算子にしない", () => {
    expect(normalizeEntityText(" ＡＢＣ ﾌｨﾙﾀｰ ")).toBe("abcふぃるたー");
    expect(matchEntity("%", "洗剤", [], null)).toBeNull();
    expect(matchEntity("ふぃるたー", "交換", [], "フィルター")).toEqual({ field: "related_name", value: "フィルター" });
    expect(matchEntity("浄水器", "本体", ["浄水器"], null)?.field).toBe("alias");
  });
  it("未知キー・kind・不正上限を拒否する", () => {
    for (const input of [0, 51, -1, 1.5, "20", null]) expect(() => limitInput(input)).toThrow("入力内容を確認してください。");
    expect(limitInput(undefined)).toBe(20);
    expect(() => kindInput("household")).toThrow("入力内容を確認してください。");
    expect(() => objectInput({ query: "x", householdId: "other" }, ["query"])).toThrow("入力内容を確認してください。");
  });
  it("cursorは期限・条件・主体・署名を検証する", async () => {
    const cursor = createReadCursor("test-only-secret-with-at-least-32-bytes");
    const now = new Date("2026-10-17T00:00:00.000Z");
    const principal = { householdId: "h", userId: "u", clientId: "c", connectionId: "g", scopes: ["household.read"] };
    const scope = cursorScope(principal, ["洗剤"]);
    const value = await cursor.encode(scope, "last", now);
    expect(await cursor.decode(value, scope, now)).toBe("last");
    await expect(cursor.decode(value, scope, new Date(now.getTime() + 900_000))).rejects.toMatchObject({ code: "cursor_expired", recovery: { action: "restart_read", omit_cursor: true } });
    for (const key of ["householdId", "userId", "clientId", "connectionId"]) {
      await expect(cursor.decode(value, cursorScope({ ...principal, [key]: "other" }, ["洗剤"]), now)).rejects.toMatchObject({ code: "invalid_cursor" });
    }
    await expect(cursor.decode(value + "x", scope, now)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(cursor.decode("junk", scope, now)).rejects.toMatchObject({ code: "invalid_cursor" });
  });
});
