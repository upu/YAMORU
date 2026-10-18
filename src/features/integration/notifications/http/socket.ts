export type PinnedTcpSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close: () => Promise<void>;
};
export type TlsEngine = {
  handshaking: () => boolean;
  peer_closed: () => boolean;
  take_tls: () => Uint8Array;
  receive_tls: (bytes: Uint8Array) => void;
  write_application: (bytes: Uint8Array) => void;
  read_application: () => Uint8Array;
  free: () => void;
};
export type OwnedConnection = { tls?: TlsEngine; socket?: PinnedTcpSocket; reader?: ReadableStreamDefaultReader<Uint8Array>; writer?: WritableStreamDefaultWriter<Uint8Array> };
