const DEFAULT_D1_BUSY_RETRY_DELAYS_MS = [50, 100, 200] as const;

export type D1FixturePhase = "clear" | "seed-owner";

function isD1BusyError(error: unknown): boolean {
  return error instanceof Error && /(?:SQLITE_BUSY|database is locked)/u.test(error.message);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function retryD1Busy<T>(
  phase: D1FixturePhase,
  operation: () => Promise<T>,
  delaysMs: readonly number[] = DEFAULT_D1_BUSY_RETRY_DELAYS_MS,
): Promise<T> {
  const maxAttempts = delaysMs.length + 1;

  for (const [index, delayMs] of delaysMs.entries()) {
    try {
      return await operation();
    } catch (error) {
      if (!isD1BusyError(error)) {
        throw error;
      }

      const nextAttempt = index + 2;
      console.warn(
        `[e2e:d1] ${phase} SQLITE_BUSY; retrying ${String(nextAttempt)}/${String(maxAttempts)} after ${String(delayMs)}ms`,
      );
      await sleep(delayMs);
    }
  }

  return operation();
}
