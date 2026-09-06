import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  formatTextGenerationCompletedLog,
  formatTextGenerationErrorLog,
  type TextGenerationFailure,
} from "../observability/item-type-suggestion";

// Issue #332: 「詳しい種類」のAI提案に使うテキスト生成。YAMORUはCloudflare
// Workers上で動く(YDR-022)ため、追加の秘密情報を持たずに使えるWorkers AIの
// バインディングをそのまま呼ぶ。ベンダーやRAG基盤を先に抽象化せず、必要に
// なった時点で差し替える(issue本文の「AIベンダー、モデル、RAG基盤などを
// 先に抽象化しすぎない」)。
// モデルはWorkers AIのcatalogで現行のものを確認してから選ぶ。当初指定していた
// @cf/meta/llama-3.1-8b-instructは2026-05-30に提供終了しており(内部では
// infire-付きの名前へ解決され、呼び出しはエラー5028で失敗していた)、記憶や
// 過去の記事を頼りにIDを決めると同じことが起きる。
//
// glm-4.7-flashを選んだ理由は、この用途の出力が「短い日本語の種類名を1〜3件、
// JSON配列で返す」だけであることによる。大きいモデルは同じ仕事でも消費する
// Neuronsが増え、下のTIMEOUT_MSにも収まりにくい。多言語のinstruction-following
// が要件で、生成量は要らない。
export const ITEM_TYPE_SUGGESTION_MODEL = "@cf/zai-org/glm-4.7-flash";
// 入力補助であり、待たされるくらいなら手入力を続けられた方がよい。
//
// 当初の8秒ではglm-4.7-flashが間に合わずtimeoutになった。ただし実際に何秒
// かかるのかを記録していなかったため、伸ばして足りるのかモデルを変えるべきかを
// 判断できなかった。暫定的に上限を広げ、あわせて成功時の所要時間
// (yamoru.text_generation_completedのdurationMs)を残す。実測が集まったら、
// 利用者を待たせない範囲へ切り下げる。
const TIMEOUT_MS = 20000;
const MAX_TOKENS = 200;

// 呼び出し元(画面)にとっては「候補を出せなかった」の一種類で足りるが、
// 運用では原因の切り分けが要る。失敗の種類はログにだけ残し、画面の文言は
// 変えない(YDR-041の6)。
export type TextGenerationResult =
  | { failure: TextGenerationFailure; status: "error" }
  | { status: "ok"; text: string };

function fail(
  failure: TextGenerationFailure,
  details?: { durationMs?: number; error?: unknown; output?: unknown },
): TextGenerationResult {
  console.error(formatTextGenerationErrorLog(failure, details));
  return { failure, status: "error" };
}

// OpenAI互換のchat completions形式(choices[0].message.content)から本文を取る。
// glm-4.7-flashはこの形で返す(previewのunreadableログのresponseKeysで確認した)。
function readChatCompletionText(choices: unknown): string | null {
  if (!Array.isArray(choices)) return null;
  const first: unknown = (choices as unknown[])[0];
  if (typeof first !== "object" || first === null) return null;
  const message: unknown = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content: unknown = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

// Workers AIの返答はモデルによって形が違う。単純な{ response: string }を返す
// ものと、OpenAI互換のchat completions形式を返すものがあるため、両方から
// 本文を取れるようにする。どちらでもなければunreadableとして扱い、
// responseKeysをログへ残して実際の形を確かめられるようにする。
function readGeneratedText(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const response: unknown = (output as { response?: unknown }).response;
  if (typeof response === "string") return response;
  return readChatCompletionText((output as { choices?: unknown }).choices);
}

// env.AI.runは中断できないため、時間切れは待つのをやめるだけで、走っている
// 要求そのものは止めない。画面へは「候補を出せなかった」として返す。
// 時間切れと「返答は来たが読めなかった」を区別するため、時間切れは専用の
// 目印を返す(nullは正当な返答値ではないので取り違えない)。
const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => { resolve(TIMED_OUT); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateText(prompt: string): Promise<TextGenerationResult> {
  let ai: CloudflareEnv["AI"];
  try {
    ({ AI: ai } = (await getCloudflareContext({ async: true })).env);
  } catch (error) {
    return fail("unavailable", { error });
  }
  if (ai === undefined) return fail("unavailable");

  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  let output: unknown;
  try {
    output = await withTimeout(ai.run(ITEM_TYPE_SUGGESTION_MODEL, {
      max_tokens: MAX_TOKENS,
      messages: [{ content: prompt, role: "user" }],
    }));
  } catch (error) {
    return fail("failed", { durationMs: elapsed(), error });
  }
  if (output === TIMED_OUT) return fail("timeout", { durationMs: elapsed() });

  const text = readGeneratedText(output);
  if (text === null) return fail("unreadable", { durationMs: elapsed(), output });

  console.log(formatTextGenerationCompletedLog(elapsed()));
  return { status: "ok", text };
}
