import { vi } from 'vitest';

/** A `fetch` stub that resolves with the given JSON body. */
export function fakeFetch(
  body: unknown,
  ok = true,
  status = 200,
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}
