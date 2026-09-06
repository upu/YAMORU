// Issue #332の続き: 「詳しい種類」のAI提案が失敗したとき、何が起きたのかを
// Workers Logsから特定できるようにする。
//
// 提案の失敗は利用者にとっては入力補助が使えないだけなので、画面には一律の
// 案内文を出して登録・編集を続けさせる(YDR-041の6)。ただしその設計のまま
// 呼び出し側で例外を握りつぶすと、バインディング未設定なのか、モデル呼び出し
// が失敗したのか、時間切れなのかを運用側からも切り分けられない。実際に
// preview配備後の初回確認でこの問題に当たったため、失敗の種類と原因の要約を
// 構造化して残す。
//
// 記録するのは失敗の種類とエラーの要約だけで、プロンプト・管理対象名・メモなど
// 家庭のデータは決して含めない(request-error.tsが経路だけを残すのと同じ方針)。

// unavailable … Workers AIのバインディングが無い(その環境ではAIを使わない)
// timeout     … 時間内に返らなかった
// failed      … 呼び出しが例外を投げた(未契約・モデル未提供・レート制限など)
// unreadable  … 返答は得られたが、想定した形から本文を取り出せなかった
export type TextGenerationFailure =
  | "failed"
  | "timeout"
  | "unavailable"
  | "unreadable";

// unknown_kind … 画面から来た大分類が保存済みの分類定義に無い
// no_candidates … 返答から候補を1件も取り出せなかった
// household … 家庭データの読み出しや提案の記録で例外が出た
export type SuggestionFailure = "household" | "no_candidates" | "unknown_kind";

export type TextGenerationErrorLog = {
  // 実際に待った時間。timeoutでは打ち切るまでに待った時間であり、タイマーの
  // 遅れの分だけ上限をわずかに超えることがある(上限そのものではない)。
  // 上限をいくつにすべきかは実測しないと決まらないため、成功時と揃えて残す。
  durationMs: number;
  event: "yamoru.text_generation_failed";
  failure: TextGenerationFailure;
  message: string;
  // 実際に呼んだモデルID。設定で変えられるため、どのモデルで起きた失敗なのか
  // をログだけで特定できるようにする。
  model: string;
  name: string;
  // unreadableのとき、返答の形だけを残す。値(生成文)は家庭の入力を映しうる
  // ため入れない。キー名が分かれば、モデル側の返答形式が変わったのかどうかを
  // 切り分けられる。
  //
  // responseKeysだけでは足りない場面が実際にあった。choicesはあるのに本文を
  // 取り出せない(chat completions形式だがcontentが文字列でない)ときに、
  // どこで止まっているのかが分からなかったため、一段深い形も残す。
  choiceKeys: string[];
  // 生成が途中で打ち切られたか("length"なら出力上限に当たっている)。
  // 列挙値であり生成文ではない。
  finishReason: string;
  messageKeys: string[];
  responseKeys: string[];
};

// 成功した呼び出しの所要時間。待ち時間の上限を実測に合わせて調整するために
// 残す。候補の内容は含めない。
export type TextGenerationCompletedLog = {
  durationMs: number;
  event: "yamoru.text_generation_completed";
  // 設定で変えたモデルが実際に使われているかを、このログで確かめられる。
  model: string;
};

// 調整用の設定値が読めなかったとき。既定値へ落として動き続けるが、設定の
// 打ち間違いに気づけるよう記録する。記録するのは変数名と設定された値だけで、
// 家庭のデータは含まない(設定値は運用者が入れた値である)。
export type ConfigErrorLog = {
  event: "yamoru.ai_config_invalid";
  value: string;
  variable: string;
};

export type SuggestionErrorLog = {
  event: "yamoru.item_type_suggestion_failed";
  failure: SuggestionFailure;
  message: string;
  name: string;
};

const MAX_MESSAGE_LENGTH = 500;

function truncate(value: string): string {
  return value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

// request-error.tsのdescribeErrorと同じ考え方で、Errorでない値も形を変えずに
// 要約する。digestはこの経路には無いため持たない。
function describeError(error: unknown): { message: string; name: string } {
  if (error instanceof Error) {
    return { message: truncate(error.message), name: error.name };
  }
  if (typeof error === "string") return { message: truncate(error), name: "string" };
  return { message: "", name: typeof error };
}

function keysOf(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value).sort() : [];
}

function propertyOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

type ResponseShape = {
  choiceKeys: string[];
  finishReason: string;
  messageKeys: string[];
  responseKeys: string[];
};

// OpenAI互換の返答は choices[0].message.content の三段になっている。どの段まで
// 届いていたのかが分かるよう、各段のキー名とfinish_reasonを取り出す。
// いずれも構造の情報だけで、生成された文は含めない。
function describeResponseShape(output: unknown): ResponseShape {
  const choices: unknown = propertyOf(output, "choices");
  const first: unknown = Array.isArray(choices) ? (choices as unknown[])[0] : undefined;
  const finishReason: unknown = propertyOf(first, "finish_reason");
  return {
    choiceKeys: keysOf(first),
    finishReason: typeof finishReason === "string" ? truncate(finishReason) : "",
    messageKeys: keysOf(propertyOf(first, "message")),
    responseKeys: keysOf(output),
  };
}

export function buildTextGenerationErrorLog(
  failure: TextGenerationFailure,
  { durationMs = 0, error, model = "", output }: {
    durationMs?: number;
    error?: unknown;
    model?: string;
    output?: unknown;
  } = {},
): TextGenerationErrorLog {
  const summary = describeError(error);
  return {
    durationMs,
    event: "yamoru.text_generation_failed",
    failure,
    message: summary.message,
    model,
    name: summary.name,
    ...describeResponseShape(output),
  };
}

export function buildSuggestionErrorLog(
  failure: SuggestionFailure,
  error?: unknown,
): SuggestionErrorLog {
  const summary = describeError(error);
  return {
    event: "yamoru.item_type_suggestion_failed",
    failure,
    message: summary.message,
    name: summary.name,
  };
}

export function formatTextGenerationErrorLog(
  failure: TextGenerationFailure,
  details?: {
    durationMs?: number;
    error?: unknown;
    model?: string;
    output?: unknown;
  },
): string {
  return JSON.stringify(buildTextGenerationErrorLog(failure, details));
}

export function formatConfigErrorLog(variable: string, value: string): string {
  const log: ConfigErrorLog = {
    event: "yamoru.ai_config_invalid",
    value: truncate(value),
    variable,
  };
  return JSON.stringify(log);
}

export function formatTextGenerationCompletedLog(
  durationMs: number,
  model: string,
): string {
  const log: TextGenerationCompletedLog = {
    durationMs,
    event: "yamoru.text_generation_completed",
    model,
  };
  return JSON.stringify(log);
}

export function formatSuggestionErrorLog(
  failure: SuggestionFailure,
  error?: unknown,
): string {
  return JSON.stringify(buildSuggestionErrorLog(failure, error));
}
