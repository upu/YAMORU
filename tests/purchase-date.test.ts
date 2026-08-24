import { describe, expect, it } from "vitest";

import {
  formatPurchaseDate,
  purchaseDatePrecision,
  splitPurchaseDate,
  toPurchaseDate,
} from "../src/app/managed-items/purchase-date";

describe("購入時期の精度(Issue #42)", () => {
  it.each([
    [{ day: "", month: "", year: "" }, null],
    [{ day: "", month: "", year: "2024" }, "2024"],
    [{ day: "", month: "5", year: "2024" }, "2024-05"],
    [{ day: "5", month: "5", year: "2024" }, "2024-05-05"],
    [{ day: "10", month: "05", year: "2024" }, "2024-05-10"],
    // 前後の空白は落とすが、値そのものは変えない。
    [{ day: " 10 ", month: " 5 ", year: " 2024 " }, "2024-05-10"],
    [{ day: "29", month: "2", year: "2024" }, "2024-02-29"],
  ])("分かる精度だけを保存する(%o)", (parts, expected) => {
    expect(toPurchaseDate(parts)).toEqual({ status: "ok", value: expected });
  });

  it.each([
    // 年のない月日、月のない日は「分かる精度」として成立しない。
    { day: "", month: "5", year: "" },
    { day: "10", month: "", year: "" },
    { day: "10", month: "", year: "2024" },
    // 4桁でない年、範囲外の月、実在しない日。
    { day: "", month: "", year: "24" },
    { day: "", month: "", year: "20240" },
    { day: "", month: "13", year: "2024" },
    { day: "", month: "0", year: "2024" },
    { day: "31", month: "2", year: "2024" },
    { day: "29", month: "2", year: "2025" },
    { day: "0", month: "5", year: "2024" },
    { day: "32", month: "5", year: "2024" },
  ])("成立しない組み合わせを拒否する(%o)", (parts) => {
    expect(toPurchaseDate(parts)).toEqual({ status: "error" });
  });

  it.each([
    ["2024", "year"],
    ["2024-05", "month"],
    ["2024-05-10", "day"],
  ])("保存された値の長さから精度が決まる(%s)", (value, expected) => {
    expect(purchaseDatePrecision(value)).toBe(expected);
  });

  it.each([
    ["2024", "2024年ごろ"],
    ["2024-05", "2024年5月"],
    ["2024-05-10", "2024年5月10日"],
    ["2024-12-31", "2024年12月31日"],
  ])("精度に合わせて表示する(%s)", (value, expected) => {
    expect(formatPurchaseDate(value)).toBe(expected);
  });

  it.each([
    [null, { day: "", month: "", year: "" }],
    ["2024", { day: "", month: "", year: "2024" }],
    ["2024-05", { day: "", month: "05", year: "2024" }],
    ["2024-05-10", { day: "10", month: "05", year: "2024" }],
  ])("編集画面の初期値へ戻す(%s)", (value, expected) => {
    expect(splitPurchaseDate(value)).toEqual(expected);
  });

  it("保存と復元を往復しても精度が変わらない", () => {
    for (const value of ["2024", "2024-05", "2024-05-10"]) {
      const parsed = toPurchaseDate(splitPurchaseDate(value));
      expect(parsed).toEqual({ status: "ok", value });
    }
  });
});
