import { HttpBytes, invalidHttp } from "./bytes";

export const MAX_HEADERS = 16_384;
export type HeaderBudget = { bytes: number; fields: number };
export async function headerLine(input: HttpBytes, budget: HeaderBudget) {
  const line = await input.line(MAX_HEADERS - budget.bytes);
  budget.bytes += line.length + 2;
  if (budget.bytes > MAX_HEADERS) invalidHttp();
  return line;
}

export function field(line: string) {
  const colon = line.indexOf(":");
  if (colon < 1) invalidHttp();
  const name = line.slice(0, colon).toLowerCase();
  const value = line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/gu, "");
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/u.test(value)) invalidHttp();
  return { name, value };
}

async function block(input: HttpBytes, budget: HeaderBudget) {
  const status = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: ([\t\x20-\xff]*))?$/u.exec(await headerLine(input, budget));
  if (!status || /[\x00-\x08\x0a-\x1f\x7f]/u.test(status.at(2) ?? "")) invalidHttp();
  const headers = new Headers();
  for (;;) {
    const line = await headerLine(input, budget);
    if (!line) return { status: Number(status[1]), statusText: status.at(2) ?? "", headers };
    if (++budget.fields > 128) invalidHttp();
    const { name, value } = field(line);
    if (["content-length", "transfer-encoding"].includes(name) && headers.has(name)) invalidHttp();
    headers.append(name, value);
  }
}

export async function finalHeaders(input: HttpBytes, budget: HeaderBudget) {
  for (let interim = 0; interim <= 4; interim++) {
    const head = await block(input, budget);
    if (head.status >= 200) return head;
    if (head.status === 101) invalidHttp();
  }
  return invalidHttp();
}

export function framing(headers: Headers) {
  const length = headers.get("content-length");
  const transfer = headers.get("transfer-encoding");
  if (length !== null && !/^[0-9]+$/u.test(length)) invalidHttp();
  if (transfer !== null && (transfer.toLowerCase() !== "chunked" || length !== null)) invalidHttp();
  if (headers.has("upgrade") || /(?:^|,)\s*upgrade\s*(?:,|$)/iu.test(headers.get("connection") ?? "")) invalidHttp();
  return { length, chunked: transfer !== null };
}
