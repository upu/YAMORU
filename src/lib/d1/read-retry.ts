// Local Miniflare writes a session bookmark even after SELECT. Another SQLite
// connection (the E2E fixture) can briefly hold that write lock. Never wrap writes.
export async function retryLocalD1Read<T>(read: () => Promise<T>, delays: readonly number[] = [25, 75, 150]): Promise<T> {
  for (const [index, delay] of delays.entries()) {
    try { return await read(); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("D1_ERROR: Failed to get session commit token:")) throw error;
      console.warn(JSON.stringify({ event: "yamoru.local_d1_read_retry", attempt: index + 2 }));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return read();
}
