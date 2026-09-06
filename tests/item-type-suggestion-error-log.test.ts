import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSuggestionErrorLog,
  buildTextGenerationErrorLog,
} from "../src/lib/observability/item-type-suggestion";

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

import { generateText } from "../src/lib/ai/text-generation";

// console.errorへ渡った行を文字列で溜め、JSONとして読み直す。spyのmock.calls
// はanyになりmax-warnings=0のlintを通せないため、記録側で型を閉じる。
const errorLines: string[] = [];

function loggedFailures(): unknown[] {
  return errorLines.map((line) => JSON.parse(line) as unknown);
}

describe("AI提案の失敗ログ(Issue #332)", () => {
  it("失敗の種類とエラーの要約だけを構造化して残す", () => {
    expect(buildTextGenerationErrorLog("failed", { error: new TypeError("boom") }))
      .toEqual({
        event: "yamoru.text_generation_failed",
        failure: "failed",
        message: "boom",
        name: "TypeError",
        responseKeys: [],
      });

    expect(buildSuggestionErrorLog("unknown_kind")).toEqual({
      event: "yamoru.item_type_suggestion_failed",
      failure: "unknown_kind",
      message: "",
      name: "undefined",
    });
  });

  it("返答を読めなかったときはキー名だけを残し、生成文は残さない", () => {
    const log = buildTextGenerationErrorLog("unreadable", {
      output: { choices: ["コーヒーマシン"], usage: { total_tokens: 12 } },
    });

    expect(log.responseKeys).toEqual(["choices", "usage"]);
    expect(JSON.stringify(log)).not.toContain("コーヒーマシン");
  });

  it("長すぎるエラーメッセージは切り詰める", () => {
    const log = buildTextGenerationErrorLog("failed", {
      error: new Error("あ".repeat(600)),
    });

    expect(Array.from(log.message)).toHaveLength(501);
    expect(log.message.endsWith("…")).toBe(true);
  });
});

describe("Workers AI呼び出しの失敗の切り分け(Issue #332)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    errorLines.length = 0;
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errorLines.push(String(line));
    });
  });

  // console.errorのspyと擬似タイマーを毎回元へ戻す。戻さないと、この
  // ファイルの他のテストや実行順の変更で失敗の出方が変わりうる。
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("バインディングが無い環境はunavailableとして記録する", async () => {
    getCloudflareContextMock.mockResolvedValue({ env: {} });

    await expect(generateText("prompt")).resolves.toEqual({
      failure: "unavailable",
      status: "error",
    });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ failure: "unavailable" }),
    ]);
  });

  it("呼び出しが例外を投げた場合はfailedとして原因を残す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockRejectedValue(new Error("Unauthorized")) } },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      failure: "failed",
      status: "error",
    });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ failure: "failed", message: "Unauthorized" }),
    ]);
  });

  it("想定した形で本文を取り出せない返答はunreadableとして形だけ残す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockResolvedValue({ choices: [] }) } },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      failure: "unreadable",
      status: "error",
    });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ failure: "unreadable", responseKeys: ["choices"] }),
    ]);
  });

  // TIMED_OUTの分岐。時間切れと「返答を読めなかった」は以前どちらもnullへ
  // 潰れていたため、別の失敗として出続けることをテストで固定する。
  it("時間内に返らない呼び出しはtimeoutとして記録する", async () => {
    vi.useFakeTimers();
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockReturnValue(new Promise(() => undefined)) } },
    });

    const pending = generateText("prompt");
    await vi.advanceTimersByTimeAsync(8000);

    await expect(pending).resolves.toEqual({ failure: "timeout", status: "error" });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ failure: "timeout", responseKeys: [] }),
    ]);
  });

  it("返答を読めた場合は成功として本文を返し、何も記録しない", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' }) } },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      status: "ok",
      text: '["コーヒーマシン"]',
    });
    expect(errorLines).toEqual([]);
  });
});
