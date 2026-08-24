import { afterEach, describe, expect, it, vi } from 'vitest';

describe('index route SSR policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('disables SSR in hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.resetModules();

    const { Route } = await import('./index');

    expect(Route.options.ssr).toBe(false);
  });

  it('enables SSR in non-hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.resetModules();

    const { Route } = await import('./index');

    expect(Route.options.ssr).toBe(true);
  });
});
