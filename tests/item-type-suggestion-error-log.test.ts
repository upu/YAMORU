import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSuggestionErrorLog,
  buildTextGenerationErrorLog,
  formatTextGenerationCompletedLog,
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
const infoLines: string[] = [];

function loggedFailures(): unknown[] {
  return errorLines.map((line) => JSON.parse(line) as unknown);
}

function loggedInfo(): unknown[] {
  return infoLines.map((line) => JSON.parse(line) as unknown);
}

describe("AI提案の失敗ログ(Issue #332)", () => {
  it("失敗の種類とエラーの要約だけを構造化して残す", () => {
    expect(buildTextGenerationErrorLog("failed", {
      error: new TypeError("boom"),
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    })).toEqual({
      choiceKeys: [],
      durationMs: 0,
      event: "yamoru.text_generation_failed",
      failure: "failed",
      finishReason: "",
      message: "boom",
      messageKeys: [],
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
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

  // responseKeysだけでは、choicesはあるのに本文を取り出せない場合にどこで
  // 止まっているのかが分からなかった。三段の形とfinish_reasonを残す。
  it("choicesの中まで形を残し、生成文は残さない", () => {
    const log = buildTextGenerationErrorLog("unreadable", {
      output: {
        choices: [{
          finish_reason: "length",
          index: 0,
          message: { content: null, reasoning_content: "コーヒーマシン", role: "assistant" },
        }],
        usage: { completion_tokens: 200 },
      },
    });

    expect(log).toMatchObject({
      choiceKeys: ["finish_reason", "index", "message"],
      finishReason: "length",
      messageKeys: ["content", "reasoning_content", "role"],
      responseKeys: ["choices", "usage"],
    });
    expect(JSON.stringify(log)).not.toContain("コーヒーマシン");
  });

  it("成功した呼び出しは所要時間・モデル・消費トークンだけを残す", () => {
    expect(JSON.parse(formatTextGenerationCompletedLog({
      durationMs: 12345,
      model: "@cf/a/b",
      output: {
        choices: [{ message: { content: "コーヒーマシン" } }],
        usage: { completion_tokens: 42 },
      },
    }))).toEqual({
      completionTokens: 42,
      durationMs: 12345,
      event: "yamoru.text_generation_completed",
      model: "@cf/a/b",
    });
  });

  it("usageを読めなければ消費トークンは0にし、生成文は残さない", () => {
    const line = formatTextGenerationCompletedLog({
      durationMs: 1,
      model: "@cf/a/b",
      output: { choices: [{ message: { content: "コーヒーマシン" } }] },
    });

    expect(JSON.parse(line)).toMatchObject({ completionTokens: 0 });
    expect(line).not.toContain("コーヒーマシン");
  });

  it("長すぎるエラーメッセージは切り詰める", () => {
    const log = buildTextGenerationErrorLog("failed", {
      error: new Error("あ".repeat(600)),
    });

    expect(Array.from(log.message)).toHaveLength(501);
    expect(log.message.endsWith("…")).toBe(true);
  });
});

// console.error/logを溜め、擬似タイマーとspyを毎回元へ戻す。戻さないと、この
// ファイルの他のテストや実行順の変更で失敗の出方が変わりうる。
function useGenerateTextLogs(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    errorLines.length = 0;
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errorLines.push(String(line));
    });
    infoLines.length = 0;
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      infoLines.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

describe("Workers AI呼び出しの失敗の切り分け(Issue #332)", () => {
  useGenerateTextLogs();

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
    await vi.advanceTimersByTimeAsync(10000);

    await expect(pending).resolves.toEqual({ failure: "timeout", status: "error" });
    // 打ち切りまでの時間も残す。上限を実測に合わせて調整する材料にする。
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ durationMs: 10000, failure: "timeout", responseKeys: [] }),
    ]);
  });

});

describe("AI提案の調整値(Issue #332)", () => {
  useGenerateTextLogs();

  it("YAMORU_AI_TIMEOUT_MSで上限を調整できる", async () => {
    vi.useFakeTimers();
    getCloudflareContextMock.mockResolvedValue({
      env: {
        AI: { run: vi.fn().mockReturnValue(new Promise(() => undefined)) },
        YAMORU_AI_TIMEOUT_MS: "3000",
      },
    });

    const pending = generateText("prompt");
    await vi.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toEqual({ failure: "timeout", status: "error" });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ durationMs: 3000, failure: "timeout" }),
    ]);
  });

  it("設定値が数でない・範囲外なら既定値へ落とし、打ち間違いを記録する", async () => {
    vi.useFakeTimers();
    getCloudflareContextMock.mockResolvedValue({
      env: {
        AI: { run: vi.fn().mockReturnValue(new Promise(() => undefined)) },
        YAMORU_AI_TIMEOUT_MS: "10秒",
      },
    });

    const pending = generateText("prompt");
    // 既定値(10000)まで進めないと打ち切られない。
    await vi.advanceTimersByTimeAsync(10000);

    await expect(pending).resolves.toEqual({ failure: "timeout", status: "error" });
    expect(loggedFailures()).toEqual([
      { event: "yamoru.ai_config_invalid", value: "10秒", variable: "YAMORU_AI_TIMEOUT_MS" },
      expect.objectContaining({ durationMs: 10000, failure: "timeout" }),
    ]);
  });

  it("YAMORU_AI_MODELで使うモデルを差し替えられる", async () => {
    const run = vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' });
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run }, YAMORU_AI_MODEL: "  @cf/other/model  " },
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ status: "ok" });

    // 前後の空白は打ち間違いとして落とす。
    expect(run).toHaveBeenCalledWith("@cf/other/model", expect.anything());
    expect(loggedInfo()).toEqual([
      expect.objectContaining({ model: "@cf/other/model" }),
    ]);
  });

  it("モデルIDの体裁を満たさない設定は既定値へ落とし、打ち間違いを記録する", async () => {
    const run = vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' });
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run }, YAMORU_AI_MODEL: "llama-4-scout-17b-16e-instruct" },
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ status: "ok" });

    expect(run).toHaveBeenCalledWith("@cf/meta/llama-4-scout-17b-16e-instruct", expect.anything());
    expect(loggedFailures()).toEqual([
      { event: "yamoru.ai_config_invalid", value: "llama-4-scout-17b-16e-instruct", variable: "YAMORU_AI_MODEL" },
    ]);
  });

  it("失敗のログにも使ったモデルを残す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockRejectedValue(new Error("5028: deprecated")) } },
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ failure: "failed" });

    expect(loggedFailures()).toEqual([
      expect.objectContaining({ model: "@cf/meta/llama-4-scout-17b-16e-instruct" }),
    ]);
  });

  it("YAMORU_AI_MAX_TOKENSで出力上限を調整できる", async () => {
    const run = vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' });
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run }, YAMORU_AI_MAX_TOKENS: "500" },
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ status: "ok" });

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ max_tokens: 500 }),
    );
  });

  it("出力上限の設定が範囲外なら既定値へ落とし、打ち間違いを記録する", async () => {
    const run = vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' });
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run }, YAMORU_AI_MAX_TOKENS: "0" },
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ status: "ok" });

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ max_tokens: 500 }),
    );
    expect(loggedFailures()).toEqual([
      { event: "yamoru.ai_config_invalid", value: "0", variable: "YAMORU_AI_MAX_TOKENS" },
    ]);
  });

  it("返答を読めた場合は本文を返し、失敗としては記録せず所要時間だけを残す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockResolvedValue({ response: '["コーヒーマシン"]' }) } },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      status: "ok",
      text: '["コーヒーマシン"]',
    });
    expect(errorLines).toEqual([]);
    expect(loggedInfo()).toEqual([
      expect.objectContaining({ event: "yamoru.text_generation_completed" }),
    ]);
  });

  // 一部のモデルはOpenAI互換のchat completions形式で返す。previewで
  // unreadableになったときのresponseKeysから形を確かめて対応した。
  it("OpenAI互換のchat completions形式からも本文を取り出す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        AI: {
          run: vi.fn().mockResolvedValue({
            choices: [{
              finish_reason: "stop",
              index: 0,
              message: { content: '["コーヒーマシン"]', role: "assistant" },
            }],
            created: 1757000000,
            id: "chatcmpl-1",
            model: "@cf/meta/llama-4-scout-17b-16e-instruct",
            object: "chat.completion",
            usage: { total_tokens: 42 },
          }),
        },
      },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      status: "ok",
      text: '["コーヒーマシン"]',
    });
    expect(errorLines).toEqual([]);
  });

  it("contentがブロックの配列でも本文を取り出す", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        AI: {
          run: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: [{ text: '["コーヒーマシン"]', type: "text" }],
                role: "assistant",
              },
            }],
          }),
        },
      },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      status: "ok",
      text: '["コーヒーマシン"]',
    });
    expect(errorLines).toEqual([]);
  });

  it("choicesはあるが本文を取り出せない形はunreadableとして扱う", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { AI: { run: vi.fn().mockResolvedValue({ choices: [], usage: {} }) } },
    });

    await expect(generateText("prompt")).resolves.toEqual({
      failure: "unreadable",
      status: "error",
    });
    expect(loggedFailures()).toEqual([
      expect.objectContaining({ failure: "unreadable", responseKeys: ["choices", "usage"] }),
    ]);
  });
});
