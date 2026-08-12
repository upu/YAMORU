import { describe, expect, it } from "vitest";

import {
  MANAGED_ITEM_KINDS,
  toManagedItemKind,
} from "../app/managed-items/model";

describe("DBから読んだkindの絞り込み", () => {
  it("CHECK制約で許される値はそのまま返す", () => {
    for (const kind of MANAGED_ITEM_KINDS) {
      expect(toManagedItemKind(kind)).toBe(kind);
    }
  });

  it("未知の値は握りつぶさず失敗させる", () => {
    // マイグレーションのCHECK制約とMANAGED_ITEM_KINDSがずれた場合に、
    // ラベル未定義のまま画面を描画してしまわないことを保証する。
    expect(() => toManagedItemKind("vehicle")).toThrow("未知の管理対象の種類です");
  });
});
