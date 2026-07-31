import { describe, expect, test } from 'bun:test';

import { createBrowserVad, resolveBrowserVadConfig } from './browser-vad.js';

type CapturedVadOptions = {
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  startOnLoad?: boolean;
  getStream?: () => Promise<MediaStream>;
  pauseStream?: (stream: MediaStream) => Promise<void>;
  resumeStream?: (stream: MediaStream) => Promise<MediaStream>;
  submitUserSpeechOnPause?: boolean;
  onSpeechStart?: () => Promise<void> | void;
  onSpeechEnd?: () => Promise<void> | void;
  onVADMisfire?: () => Promise<void> | void;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('resolveBrowserVadConfig', () => {
  test.each([
    undefined,
    true,
  ] as const)('uses automatic defaults for %p', (vad) => {
    expect(resolveBrowserVadConfig(vad)).toEqual({
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 250,
      providerOptions: {},
    });
  });

  test('keeps manual mode free of automatic configuration', () => {
    expect(resolveBrowserVadConfig(false)).toEqual({ enabled: false });
  });

  test.each([
    [null],
    ['automatic'],
    [1],
    [[]],
  ])('rejects invalid top-level VAD configuration %p', (vad) => {
    expect(() => resolveBrowserVadConfig(vad as never)).toThrow(
      'vad must be false, true, or an options object',
    );
  });

  test.each([
    ['relative/path', 'relative/path/'],
    ['/same-origin/vad', '/same-origin/vad/'],
    ['https://cdn.example.com/vad', 'https://cdn.example.com/vad/'],
  ])('normalizes an allowed asset directory', (assetBaseUrl, expected) => {
    expect(resolveBrowserVadConfig({ assetBaseUrl })).toMatchObject({
      enabled: true,
      assetBaseUrl: expected,
    });
  });

  test.each([
    '',
    ' /vad-web/ ',
    '//cdn.example.com/vad/',
    '\\\\cdn.example.com/vad/',
    'https:cdn.example.com/vad/',
    'http://cdn.example.com/vad/',
    'https://user@cdn.example.com/vad/',
    'https://cdn.example.com/vad/?version=1',
    'https://cdn.example.com/vad/#latest',
  ])('rejects unsafe asset directory %p', (assetBaseUrl) => {
    expect(() => resolveBrowserVadConfig({ assetBaseUrl })).toThrow(
      'assetBaseUrl',
    );
  });

  test.each([
    -1,
    501,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid transport pre-roll %p', (preRollMs) => {
    expect(() => resolveBrowserVadConfig({ preRollMs })).toThrow('preRollMs');
  });

  test('accepts the explicit provider tuning allowlist', () => {
    const providerOptions = {
      model: 'v5' as const,
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.4,
      redemptionMs: 500,
      preSpeechPadMs: 100,
      minSpeechMs: 250,
      processorType: 'AudioWorklet' as const,
      workletOptions: { channelCount: 1 },
    };

    expect(resolveBrowserVadConfig({ providerOptions })).toMatchObject({
      providerOptions,
    });
  });

  test('omits undefined provider tuning while preserving supplied falsey values', () => {
    const resolved = resolveBrowserVadConfig({
      providerOptions: {
        model: undefined,
        positiveSpeechThreshold: 0,
        redemptionMs: 0,
        preSpeechPadMs: undefined,
      },
    });
    if (!resolved.enabled) throw new Error('expected automatic VAD config');

    expect(resolved.providerOptions).toEqual({
      positiveSpeechThreshold: 0,
      redemptionMs: 0,
    });
    expect(Object.hasOwn(resolved.providerOptions, 'model')).toBe(false);
    expect(Object.hasOwn(resolved.providerOptions, 'preSpeechPadMs')).toBe(
      false,
    );
  });

  test('rejects reserved and unknown provider options at runtime', () => {
    expect(() =>
      resolveBrowserVadConfig({
        providerOptions: { onSpeechStart: () => {} },
      } as never),
    ).toThrow('providerOptions.onSpeechStart');
  });

  test.each([
    { model: 'future' },
    { model: 1 },
    { positiveSpeechThreshold: 2 },
    { positiveSpeechThreshold: '0.8' },
    { negativeSpeechThreshold: Number.NaN },
    { negativeSpeechThreshold: true },
    { redemptionMs: -1 },
    { redemptionMs: '500' },
    { preSpeechPadMs: null },
    { minSpeechMs: false },
    { processorType: 'future' },
    { processorType: 1 },
    { workletOptions: null },
    { workletOptions: [] },
    { workletOptions: new Date() },
  ])('rejects an invalid provider tuning value %#', (providerOptions) => {
    expect(() => resolveBrowserVadConfig({ providerOptions } as never)).toThrow(
      'providerOptions',
    );
  });
});

describe('createBrowserVad', () => {
  test('passes only supplied provider tuning to MicVAD so defaults remain intact', async () => {
    const resolved = resolveBrowserVadConfig({
      providerOptions: {
        model: undefined,
        positiveSpeechThreshold: 0,
        redemptionMs: 0,
        minSpeechMs: undefined,
      },
    });
    if (!resolved.enabled) throw new Error('expected automatic VAD config');
    let captured: CapturedVadOptions | undefined;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: resolved,
      startTurn: async () => {},
      endTurn: async () => {},
      cancelTurn: async () => {},
      onFailure: async () => {},
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {},
            destroy: async () => {},
          };
        },
      }),
    });

    expect(captured).toMatchObject({
      positiveSpeechThreshold: 0,
      redemptionMs: 0,
    });
    expect(Object.hasOwn(captured ?? {}, 'model')).toBe(false);
    expect(Object.hasOwn(captured ?? {}, 'minSpeechMs')).toBe(false);
    await controller.destroy();
  });

  test('loads MicVAD against the adapter-owned stream and starts it', async () => {
    const stream = {} as MediaStream;
    let captured: CapturedVadOptions | undefined;
    let starts = 0;
    const controller = await createBrowserVad({
      stream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: { positiveSpeechThreshold: 0.8 },
      },
      startTurn: async () => {},
      endTurn: async () => {},
      cancelTurn: async () => {},
      onFailure: async () => {},
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            async start() {
              starts += 1;
            },
            async pause() {},
            async destroy() {},
          };
        },
      }),
    });

    expect(starts).toBe(1);
    expect(captured).toMatchObject({
      baseAssetPath: '/vad-web/',
      onnxWASMBasePath: '/vad-web/',
      startOnLoad: false,
      submitUserSpeechOnPause: false,
      positiveSpeechThreshold: 0.8,
    });
    await expect(captured?.getStream?.()).resolves.toBe(stream);
    await expect(captured?.pauseStream?.(stream)).resolves.toBeUndefined();
    await expect(captured?.resumeStream?.(stream)).resolves.toBe(stream);
    await controller.destroy();
  });

  test('serializes rapid boundaries while collapsing adjacent duplicates', async () => {
    const firstStart = deferred();
    const boundaries: string[] = [];
    let captured: CapturedVadOptions | undefined;
    let starts = 0;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      async startTurn() {
        starts += 1;
        boundaries.push('start');
        if (starts === 1) await firstStart.promise;
      },
      async endTurn() {
        boundaries.push('end');
      },
      async cancelTurn() {
        boundaries.push('cancel');
      },
      onFailure: async () => {},
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {},
            destroy: async () => {},
          };
        },
      }),
    });

    const first = captured?.onSpeechStart?.();
    const duplicateFirst = captured?.onSpeechStart?.();
    const firstEnd = captured?.onSpeechEnd?.();
    const second = captured?.onSpeechStart?.();
    const secondEnd = captured?.onSpeechEnd?.();
    await Promise.resolve();
    expect(boundaries).toEqual(['start']);

    firstStart.resolve();
    await Promise.all([first, duplicateFirst, firstEnd, second, secondEnd]);

    expect(boundaries).toEqual(['start', 'end', 'start', 'end']);
    await controller.destroy();
  });

  test('cancels a started turn on VAD misfire without treating it as speech end', async () => {
    const boundaries: string[] = [];
    let captured: CapturedVadOptions | undefined;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      startTurn: async () => {
        boundaries.push('start');
      },
      endTurn: async () => {
        boundaries.push('end');
      },
      cancelTurn: async () => {
        boundaries.push('cancel');
      },
      onFailure: async () => {},
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {},
            destroy: async () => {},
          };
        },
      }),
    });

    await captured?.onSpeechStart?.();
    await captured?.onVADMisfire?.();
    expect(boundaries).toEqual(['start', 'cancel']);
    await Promise.all([captured?.onVADMisfire?.(), captured?.onSpeechEnd?.()]);
    await captured?.onSpeechStart?.();
    await captured?.onSpeechEnd?.();

    expect(boundaries).toEqual(['start', 'cancel', 'start', 'end']);
    await controller.destroy();
  });

  test('routes a failed misfire cancellation through automatic failure handling', async () => {
    const cause = new Error('misfire turn closure failed');
    let captured: CapturedVadOptions | undefined;
    const failures: unknown[] = [];
    const activeStates: boolean[] = [];
    let cancellations = 0;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      startTurn: async () => {},
      endTurn: async () => {},
      cancelTurn: async () => {
        cancellations += 1;
        throw cause;
      },
      onFailure: async (error, context) => {
        failures.push(error);
        activeStates.push(context.turnActive);
      },
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {},
            destroy: async () => {},
          };
        },
      }),
    });
    await captured?.onSpeechStart?.();

    await captured?.onVADMisfire?.();
    await captured?.onVADMisfire?.();

    expect(cancellations).toBe(1);
    expect(failures).toEqual([cause]);
    expect(activeStates).toEqual([true]);
    await controller.destroy();
  });

  test('fences callbacks after destroy so a replacement owns fresh turns', async () => {
    const boundaries: string[] = [];
    const callbacks: CapturedVadOptions[] = [];
    const makeController = () =>
      createBrowserVad({
        stream: {} as MediaStream,
        config: {
          assetBaseUrl: '/vad-web/',
          preRollMs: 250,
          providerOptions: {},
        },
        startTurn: async () => {
          boundaries.push('start');
        },
        endTurn: async () => {
          boundaries.push('end');
        },
        cancelTurn: async () => {
          boundaries.push('cancel');
        },
        onFailure: async () => {},
        loadMicVAD: async () => ({
          new: async (options?: unknown) => {
            callbacks.push(options as CapturedVadOptions);
            return {
              start: async () => {},
              pause: async () => {},
              destroy: async () => {},
            };
          },
        }),
      });

    const first = await makeController();
    await first.destroy();
    const second = await makeController();

    await callbacks[0]?.onSpeechStart?.();
    await callbacks[0]?.onSpeechEnd?.();
    await callbacks[0]?.onVADMisfire?.();
    await callbacks[1]?.onSpeechStart?.();
    await callbacks[1]?.onSpeechEnd?.();

    expect(boundaries).toEqual(['start', 'end']);
    await second.destroy();
  });

  test('closes an active automatic turn once during VAD teardown', async () => {
    let captured: CapturedVadOptions | undefined;
    let ends = 0;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      startTurn: async () => {},
      endTurn: async () => {
        ends += 1;
      },
      cancelTurn: async () => {},
      onFailure: async () => {},
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {},
            destroy: async () => {},
          };
        },
      }),
    });
    await captured?.onSpeechStart?.();

    await controller.destroy();
    await controller.destroy();
    await captured?.onSpeechEnd?.();

    expect(ends).toBe(1);
  });

  test('retires VAD after a finalized turn callback fails without finalizing twice', async () => {
    const cause = Object.assign(new Error('local drain failed'), {
      turnFinalized: true as const,
    });
    let captured: CapturedVadOptions | undefined;
    let pauses = 0;
    let destroys = 0;
    let ends = 0;
    const failures: unknown[] = [];
    const order: string[] = [];
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      startTurn: async () => {},
      endTurn: async () => {
        ends += 1;
        throw cause;
      },
      cancelTurn: async () => {},
      onFailure: async (error) => {
        order.push('failure');
        failures.push(error);
      },
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {
              order.push('pause');
              pauses += 1;
            },
            destroy: async () => {
              order.push('destroy');
              destroys += 1;
            },
          };
        },
      }),
    });
    await captured?.onSpeechStart?.();

    await captured?.onSpeechEnd?.();
    await captured?.onSpeechEnd?.();
    await captured?.onSpeechStart?.();
    await controller.destroy();

    expect(ends).toBe(1);
    expect(pauses).toBe(1);
    expect(destroys).toBe(1);
    expect(failures).toEqual([cause]);
    expect(order).toEqual(['pause', 'destroy', 'failure']);
  });

  test('hands an active turn to runtime failure handling before VAD retirement and manual mode', async () => {
    const cause = new Error('runtime VAD callback failed');
    let captured: CapturedVadOptions | undefined;
    const activeStates: boolean[] = [];
    const order: string[] = [];
    let transportClosures = 0;
    const controller = await createBrowserVad({
      stream: {} as MediaStream,
      config: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
        providerOptions: {},
      },
      startTurn: async () => {},
      endTurn: async () => {
        throw cause;
      },
      cancelTurn: async () => {},
      onFailure: async (error, context) => {
        expect(error).toBe(cause);
        activeStates.push(context.turnActive);
        if (context.turnActive) {
          transportClosures += 1;
          order.push('drain', 'pause-upstream', 'signal-turn-end');
        }
        await context.retire();
        order.push('manual');
      },
      loadMicVAD: async () => ({
        new: async (options?: unknown) => {
          captured = options as CapturedVadOptions;
          return {
            start: async () => {},
            pause: async () => {
              order.push('pause-vad');
            },
            destroy: async () => {
              order.push('destroy-vad');
            },
          };
        },
      }),
    });
    await captured?.onSpeechStart?.();

    await captured?.onSpeechEnd?.();
    await captured?.onSpeechEnd?.();

    expect(activeStates).toEqual([true]);
    expect(transportClosures).toBe(1);
    expect(order).toEqual([
      'drain',
      'pause-upstream',
      'signal-turn-end',
      'pause-vad',
      'destroy-vad',
      'manual',
    ]);
    await controller.destroy();
  });
});
