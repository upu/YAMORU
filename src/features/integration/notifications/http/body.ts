import { HttpBytes, invalidHttp, joinBytes, oversizedBody } from "./bytes";
import { field, headerLine, type HeaderBudget } from "./headers";

async function trailers(input: HttpBytes, budget: HeaderBudget) {
  for (let count = 0; count <= 32; count++) {
    const line = await headerLine(input, budget);
    if (!line) return;
    const { name } = field(line);
    if (["content-length", "transfer-encoding", "host", "connection", "trailer", "upgrade"].includes(name)) invalidHttp();
  }
  invalidHttp();
}

async function chunked(input: HttpBytes, budget: HeaderBudget) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let metadata = 0;
  for (;;) {
    const line = await input.line(1024);
    metadata += line.length + 2;
    const size = /^([0-9a-f]{1,8})(?:[ \t]*;[^\x00-\x08\x0a-\x1f\x7f]*)?$/iu.exec(line);
    if (!size || metadata > 32_768) invalidHttp();
    const count = Number.parseInt(size[1], 16);
    if (!count) { await trailers(input, budget); return joinBytes(chunks, total); }
    if (total + count > 4096) oversizedBody();
    chunks.push(await input.exact(count));
    total += count;
    const ending = await input.exact(2);
    if (ending[0] !== 13 || ending[1] !== 10) invalidHttp();
  }
}

export async function responseBody(input: HttpBytes, headers: Headers, mode: { length: string | null; chunked: boolean }, budget: HeaderBudget) {
  if ((headers.get("content-encoding") ?? "identity").toLowerCase() !== "identity") invalidHttp();
  if (mode.chunked) return chunked(input, budget);
  if (mode.length === null) return input.rest();
  const size = Number(mode.length);
  if (size > 4096) oversizedBody();
  return input.exact(size);
}
