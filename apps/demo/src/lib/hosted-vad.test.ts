import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('preloadHostedVadAssets', () => {
  it('fully downloads every runtime asset before resolving', async () => {
    const consumed: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          consumed.push(url);
          return new ArrayBuffer(1);
        },
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { HOSTED_VAD_ASSET_NAMES, preloadHostedVadAssets } = await import(
      './hosted-vad'
    );

    await Promise.all([preloadHostedVadAssets(), preloadHostedVadAssets()]);

    expect(fetchMock).toHaveBeenCalledTimes(HOSTED_VAD_ASSET_NAMES.length);
    expect(consumed).toEqual(
      HOSTED_VAD_ASSET_NAMES.map((name) => `/vad-web/${name}`),
    );
  });

  it('allows a later attempt after a failed preload', async () => {
    let succeeds = false;
    const fetchMock = vi.fn(async () => {
      if (!succeeds) throw new Error('offline');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(1),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { preloadHostedVadAssets } = await import('./hosted-vad');

    await expect(preloadHostedVadAssets()).rejects.toThrow('offline');
    succeeds = true;
    await expect(preloadHostedVadAssets()).resolves.toBeUndefined();
  });
});
