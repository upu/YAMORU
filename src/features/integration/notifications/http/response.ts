import { HttpBytes, type PlaintextRead } from "./bytes";
import { finalHeaders, framing } from "./headers";
import { responseBody } from "./body";

export async function readPinnedHttpResponse(read: PlaintextRead, options: { headOnly: boolean }) {
  const input = new HttpBytes(read);
  const budget = { bytes: 0, fields: 0 };
  const head = await finalHeaders(input, budget);
  const mode = framing(head.headers);
  if (options.headOnly || [204, 205, 304].includes(head.status) || head.status >= 300 && head.status < 400) return new Response(null, head);
  const body = await responseBody(input, head.headers, mode, budget);
  for (const field of ["transfer-encoding", "trailer", "connection", "keep-alive", "upgrade"]) head.headers.delete(field);
  head.headers.set("content-length", String(body.length));
  return new Response(body, head);
}
