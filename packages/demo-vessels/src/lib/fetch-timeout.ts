const DEFAULT_FETCH_TIMEOUT_MS = 8000;

/**
 * Combines a fixed timeout with an optional caller-supplied abort signal, so
 * a stalled request always aborts even if nothing else cancels it — the public
 * demo servers this app calls (OSRM, Open-Meteo) can stall a connection
 * indefinitely, and without this the caller's catch-and-degrade path never runs.
 */
export function withFetchTimeout(
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
