import { getCloudflareContext } from "@opennextjs/cloudflare";

// Issue #332: 「詳しい種類」のAI提案に使うテキスト生成。YAMORUはCloudflare
// Workers上で動く(YDR-022)ため、追加の秘密情報を持たずに使えるWorkers AIの
// バインディングをそのまま呼ぶ。ベンダーやRAG基盤を先に抽象化せず、必要に
// なった時点で差し替える(issue本文の「AIベンダー、モデル、RAG基盤などを
// 先に抽象化しすぎない」)。
export const ITEM_TYPE_SUGGESTION_MODEL = "@cf/meta/llama-3.1-8b-instruct";
// 入力補助であり、待たされるくらいなら手入力を続けられた方がよい。
const TIMEOUT_MS = 8000;
const MAX_TOKENS = 200;

// unavailable: この環境ではAIを使えない(バインディング未設定)。
// error: 呼び出しに失敗した、時間内に返らなかった、返答を読めなかった。
// いずれの場合も画面は既存の手動入力と#288の候補選択を続けられる。
export type TextGenerationResult =
  | { status: "error" }
  | { status: "ok"; text: string }
  | { status: "unavailable" };

function readGeneratedText(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const response: unknown = (output as { response?: unknown }).response;
  return typeof response === "string" ? response : null;
}

// env.AI.runは中断できないため、時間切れは待つのをやめるだけで、走っている
// 要求そのものは止めない。画面へは「候補を出せなかった」として返す。
async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => { resolve(null); }, TIMEOUT_MS);
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
  } catch {
    return { status: "unavailable" };
  }
  if (ai === undefined) return { status: "unavailable" };

  let output: unknown;
  try {
    output = await withTimeout(ai.run(ITEM_TYPE_SUGGESTION_MODEL, {
      max_tokens: MAX_TOKENS,
      messages: [{ content: prompt, role: "user" }],
    }));
  } catch {
    return { status: "error" };
  }
  const text = readGeneratedText(output);
  return text === null ? { status: "error" } : { status: "ok", text };
}
