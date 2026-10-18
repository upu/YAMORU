import { WebhookEndpointError } from "../webhook-transport";

export type PlaintextRead = () => Promise<Uint8Array | null>;
export function invalidHttp(): never { throw new WebhookEndpointError("unreachable", true); }
export function oversizedBody(): never { throw new WebhookEndpointError("payload_too_large", true); }
function lineByte(bytes: number[], byte: number, limit: number) {
  if (byte === 10 || bytes.length >= limit) invalidHttp();
  bytes.push(byte);
}

export class HttpBytes {
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private readonly read: PlaintextRead;
  constructor(read: PlaintextRead) { this.read = read; }

  async available() {
    if (this.offset < this.chunk.length) return true;
    const next = await this.read();
    if (next === null) return false;
    if (!next.length || next.length > 16_384) invalidHttp();
    this.chunk = next;
    this.offset = 0;
    return true;
  }

  async line(limit: number): Promise<string> {
    const bytes: number[] = [];
    let cr = false;
    while (await this.available()) {
      const byte = this.chunk[this.offset++];
      if (cr) {
        if (byte !== 10) invalidHttp();
        return String.fromCharCode(...bytes);
      }
      if (byte === 13) cr = true;
      else lineByte(bytes, byte, limit);
    }
    return invalidHttp();
  }

  async exact(size: number) {
    if (!Number.isInteger(size) || size < 0 || size > 4096) invalidHttp();
    const output = new Uint8Array(size);
    let written = 0;
    while (written < size) {
      if (!await this.available()) invalidHttp();
      const count = Math.min(size - written, this.chunk.length - this.offset);
      output.set(this.chunk.subarray(this.offset, this.offset + count), written);
      this.offset += count;
      written += count;
    }
    return output;
  }

  async rest() {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (await this.available()) {
      const chunk = this.chunk.subarray(this.offset);
      total += chunk.length;
      if (total > 4096) oversizedBody();
      chunks.push(chunk);
      this.offset = this.chunk.length;
    }
    return joinBytes(chunks, total);
  }
}

export function joinBytes(chunks: readonly Uint8Array[], size: number) {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
