// Drains queued microtasks so a fire-and-forget async chain gets the chance
// to run to completion before assertions inspect its result.
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
