import { WebhookEndpointError } from "../webhook-transport";
import type { OwnedConnection } from "./socket";

export class IoScope {
  requestStarted = false;
  private readonly signal: AbortSignal;
  private readonly interrupted: Promise<never>;
  private readonly abort: () => void;
  private readonly onStart: (() => void) | undefined;
  constructor(signal: AbortSignal, onStart?: () => void) {
    this.signal = signal;
    this.onStart = onStart;
    let rejectAbort: (reason: Error) => void = () => {};
    this.interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    this.abort = () => { rejectAbort(new WebhookEndpointError("timeout", this.requestStarted)); };
    void this.interrupted.catch(() => {});
    signal.addEventListener("abort", this.abort, { once: true });
  }
  check() { if (this.signal.aborted) throw new WebhookEndpointError("timeout", this.requestStarted); }
  beginRequest() { this.check(); this.requestStarted = true; this.onStart?.(); }
  async wait<T>(run: () => Promise<T>): Promise<T> {
    this.check();
    const value = await Promise.race([run(), this.interrupted]);
    this.check();
    return value;
  }
  dispose() { this.signal.removeEventListener("abort", this.abort); }
}

function stop(run: () => Promise<unknown>) {
  try { void run().catch(() => {}); } catch { /* Closing one resource must not prevent the others from closing. */ }
}
export function closeOwned(owned: OwnedConnection) {
  // Native close promises must not extend the request's deadline. Pending I/O cannot call TLS after an interrupted wait.
  if (owned.socket) { const socket = owned.socket; stop(() => socket.close()); }
  if (owned.reader) { const reader = owned.reader; stop(() => reader.cancel()); }
  if (owned.writer) { const writer = owned.writer; stop(() => writer.abort()); }
  owned.tls?.free();
}
