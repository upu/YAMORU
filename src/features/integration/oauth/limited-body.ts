// 外部から受け取る本文(token endpointへの要求、CIMDの応答)を、上限を超えた
// 時点で読むのをやめて捨てる。全体を先にメモリへ載せてから大きさを見ると、
// 巨大な本文で上限が意味を持たない。上限を超えたらnull、本文が無ければ空文字。
export async function readTextWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (body === null) return "";
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try { return await readChunks(reader, maxBytes, signal); }
  finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}
async function readChunks(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    signal?.throwIfAborted();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Content-Lengthが上限を超えると宣言している要求は、本文を読まずに拒否する。
export function declaresTooLargeBody(headers: Headers, maxBytes: number): boolean {
  const declared = Number(headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}
