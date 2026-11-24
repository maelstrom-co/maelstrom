import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ['1', false],
  ['0', true],
] as const)(
  'sets Talking Points SSR policy for hosted=%s',
  async (hosted, ssr) => {
    vi.stubEnv('VITE_HOSTED', hosted);
    const { Route } = await import('./talking-points');
    expect(Route.options.ssr).toBe(ssr);
    const head = Route.options.head as unknown as () => {
      meta: { title?: string }[];
    };
    expect(head().meta).toContainEqual({
      title: 'Talking Points, powered by Maelstrom',
    });
  },
  15_000,
);
