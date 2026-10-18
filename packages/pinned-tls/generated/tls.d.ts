/* tslint:disable */
/* eslint-disable */

export class TlsClient {
    free(): void;
    [Symbol.dispose](): void;
    handshaking(): boolean;
    constructor(hostname: string);
    peer_closed(): boolean;
    read_application(): Uint8Array;
    receive_tls(bytes: Uint8Array): void;
    take_tls(): Uint8Array;
    write_application(bytes: Uint8Array): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tlsclient_free: (a: number, b: number) => void;
    readonly tlsclient_handshaking: (a: number, b: number) => void;
    readonly tlsclient_new: (a: number, b: number, c: number) => void;
    readonly tlsclient_peer_closed: (a: number, b: number) => void;
    readonly tlsclient_read_application: (a: number, b: number) => void;
    readonly tlsclient_receive_tls: (a: number, b: number, c: number, d: number) => void;
    readonly tlsclient_take_tls: (a: number, b: number) => void;
    readonly tlsclient_write_application: (a: number, b: number, c: number, d: number) => void;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
