// Issue #116スパイク: `npx wrangler types`はWorkersランタイム全体の型を
// グローバルに生成するが、そのdeclareがDOM lib(Element/HTMLElement等)と衝突し、
// 既存の`npm run typecheck`(jsdomを使うコンポーネントテスト)を壊すことを確認した。
// そのため`wrangler types`の生成物は使わず、このスパイクで実際に使う分だけの
// 最小限の型をここに手書きする(判明した制約としてdocs/spikes/cloudflare-workers-d1.md
// に記録)。

declare global {
  interface D1Result<T = unknown> {
    results: T[];
    success: true;
    meta: {
      changes: number;
      duration: number;
      last_row_id: number;
      rows_read: number;
      rows_written: number;
      [key: string]: unknown;
    };
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Result<T>>;
    all<T = unknown>(): Promise<D1Result<T>>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(
      statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]>;
    exec(query: string): Promise<{ count: number; duration: number }>;
  }

  interface CloudflareEnv {
    DB: D1Database;
  }
}

export {};
