import { describe, expect, it } from "vitest";

import { canonicalJson, CommandError } from "../src/features/integration/commands/contract";
import { occurredValue, parseCommitRequest, parsePrepareRequest } from "../src/features/integration/commands/input";

// 外部command(#437)の入力検証と、同じ内容を同じ指紋にする正規化。
const OPERATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = new Date("2026-10-12T03:00:00.000Z");

function errorOf(run: () => unknown): CommandError {
  try {
    run();
  } catch (error) {
    if (error instanceof CommandError) return error;
    throw error;
  }
  throw new Error("CommandErrorが投げられませんでした");
}

describe("canonicalJson", () => {
  it("キーの順序によらず同じ文字列にし、undefinedの項目は含めない", () => {
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: "x", z: undefined }))
      .toBe(canonicalJson({ a: "x", b: [1, { c: 3, d: 2 }] }));
    expect(canonicalJson({ a: [2, 1] })).not.toBe(canonicalJson({ a: [1, 2] }));
  });
});

describe("prepare/commitの入力", () => {
  it("操作IDはUUIDに限り、未知のcommandと未知の項目は受け付けない", () => {
    expect(errorOf(() => parsePrepareRequest({ command: "todo.complete", operation_id: "1" })).fieldErrors)
      .toEqual({ operation_id: "uuid_required" });
    expect(errorOf(() => parsePrepareRequest({ command: "sql.run", operation_id: OPERATION_ID })).code)
      .toBe("unsupported_capability");
    expect(errorOf(() => parsePrepareRequest({ command: "todo.complete", operation_id: OPERATION_ID, scope: "x" })).fieldErrors)
      .toEqual({ "input.scope": "unknown_field" });
  });

  it("commitではpayloadを受け取らず、未実装の確認tokenは未対応として返す", () => {
    const base = { fingerprint: "a".repeat(64), operation_id: OPERATION_ID, preview_id: OPERATION_ID };
    expect(parseCommitRequest(base)).toEqual({ fingerprint: "a".repeat(64), operationId: OPERATION_ID, previewId: OPERATION_ID });
    expect(errorOf(() => parseCommitRequest({ ...base, payload: {} })).code).toBe("invalid_input");
    expect(errorOf(() => parseCommitRequest({ ...base, confirmation_token: "t" })).code).toBe("unsupported_capability");
  });
});

describe("実施日時", () => {
  it("日付は東京の0時として扱い、日時はUTCへ揃える", () => {
    expect(occurredValue({ occurred_on: "2026-10-11" }, "payload", NOW))
      .toEqual({ datePrecision: "day", occurredAt: "2026-10-10T15:00:00.000Z" });
    expect(occurredValue({ occurred_at: "2026-10-12T09:30+09:00" }, "payload", NOW))
      .toEqual({ datePrecision: "instant", occurredAt: "2026-10-12T00:30:00.000Z" });
    expect(occurredValue({}, "payload", NOW)).toBeNull();
  });

  it("日付と日時の同時指定、存在しない日付、未来を拒否する", () => {
    expect(errorOf(() => occurredValue({ occurred_at: "2026-10-12T00:00Z", occurred_on: "2026-10-12" }, "payload", NOW)).fieldErrors)
      .toEqual({ payload: "occurred_on_or_occurred_at" });
    expect(errorOf(() => occurredValue({ occurred_on: "2026-02-30" }, "payload", NOW)).fieldErrors)
      .toEqual({ "payload.occurred_on": "date_required" });
    expect(errorOf(() => occurredValue({ occurred_at: "2026-10-12T03:00:01Z" }, "payload", NOW)).fieldErrors)
      .toEqual({ "payload.occurred_at": "future_datetime" });
    expect(errorOf(() => occurredValue({ occurred_at: "2026-10-12 03:00" }, "payload", NOW)).fieldErrors)
      .toEqual({ "payload.occurred_at": "datetime_required" });
  });
});
