import { WebhookEndpointError } from "../webhook-transport";
import { IoScope } from "./lifecycle";
import type { TlsEngine } from "./socket";

export class TlsChannel {
  private readonly tls: TlsEngine;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly scope: IoScope;
  private pending: Uint8Array = new Uint8Array();
  private offset = 0;
  private received = 0;
  private reads = 0;
  constructor(tls: TlsEngine, reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>, scope: IoScope) {
    this.tls = tls; this.reader = reader; this.writer = writer; this.scope = scope;
  }
  private async flush() {
    this.scope.check();
    const bytes = this.tls.take_tls();
    if (bytes.length) await this.scope.wait(() => this.writer.write(bytes));
  }
  private async receive() {
    this.scope.check();
    if (this.offset >= this.pending.length) await this.readSocket();
    const count = Math.min(65_536, this.pending.length - this.offset);
    this.tls.receive_tls(this.pending.subarray(this.offset, this.offset + count));
    this.offset += count;
  }
  private async readSocket() {
    if (++this.reads > 1024) throw new WebhookEndpointError("unreachable", this.scope.requestStarted);
    const result = await this.scope.wait(() => this.reader.read());
    if (result.done || !result.value.length) throw new WebhookEndpointError("unreachable", this.scope.requestStarted);
    this.received += result.value.length;
    if (this.received > 262_144) throw new WebhookEndpointError("unreachable", this.scope.requestStarted);
    this.pending = result.value;
    this.offset = 0;
  }
  async handshake(opened: Promise<unknown>, connected?: () => void) {
    await this.scope.wait(() => opened);
    connected?.();
    while (this.tls.handshaking()) { await this.flush(); await this.receive(); }
    await this.flush();
  }
  async send(bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      this.scope.check();
      this.scope.beginRequest();
      this.tls.write_application(bytes.subarray(offset, offset + 16_384));
      await this.flush();
    }
  }
  async read(): Promise<Uint8Array | null> {
    for (;;) {
      this.scope.check();
      const bytes = this.tls.read_application();
      if (bytes.length) return bytes;
      if (this.tls.peer_closed()) return null;
      await this.receive();
      await this.flush();
    }
  }
}
