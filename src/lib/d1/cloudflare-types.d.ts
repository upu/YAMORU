// Workers全体の生成型はDOM型と衝突するため、アプリが使うD1バインディングだけを宣言する。
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
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<{ count: number; duration: number }>;
  }

  // Issue #332: 「詳しい種類」のAI提案に使うWorkers AIバインディング。
  // アプリが呼ぶrun()の形だけを宣言する(D1と同じく、Workers全体の生成型は
  // DOM型と衝突するため取り込まない)。
  interface WorkersAi {
    run(
      model: string,
      input: {
        max_tokens?: number;
        messages: { content: string; role: string }[];
      },
    ): Promise<unknown>;
  }

  interface CloudflareEnv {
    // ローカル開発やAIを設定していない環境ではバインディングが無い。
    // その場合でも登録・編集は動き続ける必要があるため、任意とする。
    AI?: WorkersAi;
    AUTH_SECRET: string;
    DB: D1Database;
    YAMORU_ENVIRONMENT?: "preview" | "production";
  }
}

export {};
