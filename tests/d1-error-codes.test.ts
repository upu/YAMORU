import { describe, expect, it } from "vitest";

import {
  D1_ERROR_CODES,
  D1ConflictError,
  D1NotFoundError,
  d1ErrorCode,
} from "../src/lib/d1/errors";

// Issue #369: 業務エラーの識別コードは、画面の案内文と対応づけるための安定した
// 契約。判定がクラス同一性やNode組み込みの`code`と混ざらないことを確かめる。
describe("D1エラーの識別コード", () => {
  it("識別コードを持つエラーからコードを読み取る", () => {
    expect(d1ErrorCode(new D1ConflictError("Occurrence is not pending", "OCCURRENCE_NOT_PENDING")))
      .toBe("OCCURRENCE_NOT_PENDING");
    expect(d1ErrorCode(new D1NotFoundError("Occurrence not found", "OCCURRENCE_NOT_FOUND")))
      .toBe("OCCURRENCE_NOT_FOUND");
  });

  it("コードを持たないエラーはundefinedにする", () => {
    expect(d1ErrorCode(new D1ConflictError("Unsupported recurrence basis"))).toBeUndefined();
    expect(d1ErrorCode(new Error("Occurrence is not pending"))).toBeUndefined();
    expect(d1ErrorCode("Occurrence is not pending")).toBeUndefined();
  });

  it("一覧にないcodeを持つエラー(Node組み込みなど)は取り違えない", () => {
    const systemError = Object.assign(new Error("open failed"), { code: "ENOENT" });
    expect(d1ErrorCode(systemError)).toBeUndefined();
  });

  it("識別コードは重複しない", () => {
    expect(new Set(D1_ERROR_CODES).size).toBe(D1_ERROR_CODES.length);
  });
});
