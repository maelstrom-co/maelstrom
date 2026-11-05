import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tasks route SSR policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('disables SSR in hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.resetModules();

    const { Route } = await import('./tasks');

    expect(Route.options.ssr).toBe(false);
  }, 15_000);

  it('enables SSR in non-hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.resetModules();

    const { Route } = await import('./tasks');

    expect(Route.options.ssr).toBe(true);
  });

  it('titles the tab Tasklane, powered by Maelstrom', async () => {
    const { Route } = await import('./tasks');
    const head = Route.options.head as unknown as () => {
      meta: { title?: string }[];
    };

    expect(head().meta).toContainEqual({
      title: 'Tasklane, powered by Maelstrom',
    });
  });
});
