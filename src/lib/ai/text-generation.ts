import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  formatConfigErrorLog,
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
// llama-4-scoutを選んだ理由は、この用途の出力が「短い日本語の種類名を1〜3件、
// JSON配列で返す」だけであることによる。多言語のinstruction-followingが要件で、
// 生成量は要らない。
//
// 当初はglm-4.7-flashを使ったが、これは思考を出力トークンとして消費する推論
// モデルで、候補そのものは数十トークンなのに思考だけで1400〜2000超を使い、
// 上限に届くと本文が空のまま返ってくる(finish_reason: "length")。思考は
// thinkingパラメータでは止められないことを実測で確認した。同じ問いを実測で
// 比べた結果は次のとおり。
//
//   glm-4.7-flash          2〜6秒  59〜74 Neurons  本文が空になることがある
//   llama-4-scout          1秒未満  6〜7 Neurons   常にJSON配列を返した
//
// 思考しないモデルへ替えることで、失敗の原因そのものが無くなり、費用は約10分の
// 1、待ち時間は数分の1になる。
//
// モデルは提供終了する。実際に一度当たっており、そのたびにコードを変えて
// 配備し直すのは復旧を遅らせるだけなので、待ち時間の上限と同じくCloudflare
// Dashboardのruntime変数YAMORU_AI_MODELで差し替えられるようにする。ここに
// 置くのは変数が無いときの既定値である。恒久的に別のモデルにする場合は、
// 変数だけで済ませずこの既定値も直す(catalogで現行のIDを確認してから)。
const DEFAULT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
// Workers AIのモデルIDはこの接頭辞を持つ。前後の空白は打ち間違いとして落とす
// が、接頭辞が違う値や長すぎる値は既定値へ落とす。
const MODEL_PREFIX = "@cf/";
const MAX_MODEL_LENGTH = 200;
const MODEL_VARIABLE = "YAMORU_AI_MODEL";

function resolveModel(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_MODEL;
  const model = raw.trim();
  if (
    !model.startsWith(MODEL_PREFIX)
    || model.length > MAX_MODEL_LENGTH
  ) {
    console.error(formatConfigErrorLog(MODEL_VARIABLE, raw));
    return DEFAULT_MODEL;
  }
  return model;
}
// 入力補助であり、待たされるくらいなら手入力を続けられた方がよい。
//
// 当初の8秒ではglm-4.7-flashが間に合わずtimeoutになった。llama-4-scoutでの
// 実測は1秒未満で、10秒はその十倍の余裕である。何秒が妥当かはモデルを替える
// たびに変わり、そのつどコードを変えて配備し直すのは回り道になるため、上限は
// Cloudflare Dashboardのruntime変数YAMORU_AI_TIMEOUT_MSで調整できるように
// する。ここに置くのは変数が無いときの既定値である。
//
// wrangler.jsoncへは書かない。配備は--keep-varsで行うため、設定ファイルに
// 書いた値は毎回の配備で上書きされ、Dashboardでの調整が効かなくなる。
const DEFAULT_TIMEOUT_MS = 10000;
// 1秒未満は補助として意味がなく、60秒を超えると利用者はとうに待つのをやめて
// いる。打ち間違いでこの範囲を外れた値が入ったら既定値へ落とす。
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;
const TIMEOUT_VARIABLE = "YAMORU_AI_TIMEOUT_MS";

// 設定を読めなくても提案そのものは続けられるよう、既定値へ落として動かす。
// ただし黙って無視すると打ち間違いに気づけないため記録する。
function resolveTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_TIMEOUT_MS
    || parsed > MAX_TIMEOUT_MS
  ) {
    console.error(formatConfigErrorLog(TIMEOUT_VARIABLE, raw));
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}
// 1回の生成で許す出力トークン数。
//
// 当初の200では足りなかった。glm-4.7-flashは思考過程(reasoning_content)を
// 出すモデルで、200を思考だけで使い切り、contentへ到達する前にfinish_reason
// がlengthで打ち切られていた。思考にどれだけ要るかはモデルと入力で変わり、
// 候補そのものは実測で13〜29トークンに収まる。500はその十数倍で、返答が
// 途中で切れないための余裕である。
//
// 思考するモデルへ差し替えるとこの余裕では足りなくなる(思考も出力トークンを
// 消費するため)ので、待ち時間の上限やモデルと同じくruntime変数
// YAMORU_AI_MAX_TOKENSで調整できるようにしておく。成功時の
// yamoru.text_generation_completedがcompletionTokensを残すので、実測を見て
// 決め直せる。
const DEFAULT_MAX_TOKENS = 500;
// 1未満は生成できず、8000を超えると待ち時間と費用に見合わない。
const MIN_MAX_TOKENS = 1;
const MAX_MAX_TOKENS = 8000;
const MAX_TOKENS_VARIABLE = "YAMORU_AI_MAX_TOKENS";

function resolveMaxTokens(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_TOKENS;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_MAX_TOKENS
    || parsed > MAX_MAX_TOKENS
  ) {
    console.error(formatConfigErrorLog(MAX_TOKENS_VARIABLE, raw));
    return DEFAULT_MAX_TOKENS;
  }
  return parsed;
}

// 呼び出し元(画面)にとっては「候補を出せなかった」の一種類で足りるが、
// 運用では原因の切り分けが要る。失敗の種類はログにだけ残し、画面の文言は
// 変えない(YDR-041の6)。
export type TextGenerationResult =
  | { failure: TextGenerationFailure; status: "error" }
  | { status: "ok"; text: string };

function fail(
  failure: TextGenerationFailure,
  details?: {
    durationMs?: number;
    error?: unknown;
    model?: string;
    output?: unknown;
  },
): TextGenerationResult {
  console.error(formatTextGenerationErrorLog(failure, details));
  return { failure, status: "error" };
}

// contentは文字列とは限らず、[{ type: "text", text: "..." }]のようなブロックの
// 配列で返す実装もある。文字列のtextだけを順につないで本文とする。
function readContentBlocks(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const texts = (content as unknown[])
    .map((block) => (block as { text?: unknown } | null)?.text)
    .filter((text): text is string => typeof text === "string");
  return texts.length === 0 ? null : texts.join("");
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
  if (typeof content === "string") return content;
  return readContentBlocks(content);
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

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => { resolve(TIMED_OUT); }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateText(prompt: string): Promise<TextGenerationResult> {
  let env: CloudflareEnv;
  try {
    ({ env } = await getCloudflareContext({ async: true }));
  } catch (error) {
    return fail("unavailable", { error });
  }
  const ai = env.AI;
  if (ai === undefined) return fail("unavailable");
  const timeoutMs = resolveTimeoutMs(env.YAMORU_AI_TIMEOUT_MS);
  const model = resolveModel(env.YAMORU_AI_MODEL);
  const maxTokens = resolveMaxTokens(env.YAMORU_AI_MAX_TOKENS);

  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  let output: unknown;
  try {
    output = await withTimeout(ai.run(model, {
      max_tokens: maxTokens,
      messages: [{ content: prompt, role: "user" }],
    }), timeoutMs);
  } catch (error) {
    return fail("failed", { durationMs: elapsed(), error, model });
  }
  if (output === TIMED_OUT) {
    return fail("timeout", { durationMs: elapsed(), model });
  }

  const text = readGeneratedText(output);
  if (text === null) {
    return fail("unreadable", { durationMs: elapsed(), model, output });
  }

  console.log(formatTextGenerationCompletedLog({
    durationMs: elapsed(),
    model,
    output,
  }));
  return { status: "ok", text };
}
