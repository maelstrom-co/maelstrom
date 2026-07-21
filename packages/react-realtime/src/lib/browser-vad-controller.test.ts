import { describe, expect, it } from 'bun:test';

import { createBrowserVadController } from './browser-vad-controller.js';

type AdapterTurnControl = {
  startTurn(): Promise<void>;
  endTurn(): Promise<void>;
};

type CapturedVadOptions = {
  audioContext?: AudioContext;
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  model?: 'legacy' | 'v5';
  positiveSpeechThreshold?: number;
  startOnLoad?: boolean;
  getStream?: () => Promise<MediaStream>;
  pauseStream?: (stream: MediaStream) => Promise<void>;
  resumeStream?: (stream: MediaStream) => Promise<MediaStream>;
  submitUserSpeechOnPause?: boolean;
  onSpeechStart?: () => Promise<void> | void;
  onSpeechEnd?: (audio: Float32Array) => Promise<void> | void;
  onVADMisfire?: () => Promise<void> | void;
  onSpeechRealStart?: () => Promise<void> | void;
  onFrameProcessed?: () => Promise<void> | void;
  ortConfig?: unknown;
};

type FakeMicVad = {
  readonly startCalls: number;
  readonly pauseCalls: number;
  readonly destroyCalls: number;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStream() {
  let stopCalls = 0;
  const track = {
    stop() {
      stopCalls += 1;
    },
  };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  return {
    stream,
    get stopCalls() {
      return stopCalls;
    },
  };
}

function makeFakeVad(): FakeMicVad {
  let startCalls = 0;
  let pauseCalls = 0;
  let destroyCalls = 0;
  return {
    get startCalls() {
      return startCalls;
    },
    get pauseCalls() {
      return pauseCalls;
    },
    get destroyCalls() {
      return destroyCalls;
    },
    async start() {
      startCalls += 1;
    },
    async pause() {
      pauseCalls += 1;
    },
    async destroy() {
      destroyCalls += 1;
    },
  };
}

function makeDelayedPauseVad() {
  const pause = deferred<void>();
  const fakeVad = makeFakeVad();
  return {
    fakeVad: {
      get startCalls() {
        return fakeVad.startCalls;
      },
      get pauseCalls() {
        return fakeVad.pauseCalls;
      },
      get destroyCalls() {
        return fakeVad.destroyCalls;
      },
      start: fakeVad.start,
      destroy: fakeVad.destroy,
      async pause() {
        await pause.promise;
        await fakeVad.pause();
      },
    },
    releasePause: () => pause.resolve(),
  };
}

function makeTurnControl(overrides: Partial<AdapterTurnControl> = {}) {
  let startCalls = 0;
  let endCalls = 0;
  const turnControl: AdapterTurnControl = {
    async startTurn() {
      startCalls += 1;
    },
    async endTurn() {
      endCalls += 1;
    },
    ...overrides,
  };
  return {
    turnControl,
    get startCalls() {
      return startCalls;
    },
    get endCalls() {
      return endCalls;
    },
  };
}

function makeControllerFixture(
  options: {
    readonly mic?: MediaStream;
    readonly turnControl?: AdapterTurnControl;
    readonly loadError?: unknown;
    readonly assetBaseUrl?: string;
    readonly providerOptions?: Record<string, unknown>;
  } = {},
) {
  const fakeVad = makeFakeVad();
  const errors: unknown[] = [];
  let capturedOptions: CapturedVadOptions | undefined;
  const controller = createBrowserVadController({
    session: { getAudioStreams: () => ({ mic: options.mic }) },
    turnControl: options.turnControl ?? makeTurnControl().turnControl,
    onError: (error: unknown) => errors.push(error),
    assetBaseUrl: options.assetBaseUrl ?? '/vad-web/',
    providerOptions: options.providerOptions,
    loadMicVAD: async () => {
      if (options.loadError) throw options.loadError;
      return {
        new: async (vadOptions: CapturedVadOptions) => {
          capturedOptions = vadOptions;
          return fakeVad;
        },
      };
    },
  });

  return {
    controller,
    fakeVad,
    errors,
    getCapturedOptions() {
      if (!capturedOptions) throw new Error('MicVAD.new was not called');
      return capturedOptions;
    },
  };
}

describe('createBrowserVadController', () => {
  it('initializes MicVAD with the existing session mic and LiveKit-safe stream lifecycle hooks', async () => {
    const existingMic = makeStream();
    const { controller, fakeVad, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();

    expect(capturedOptions.startOnLoad).toBe(false);
    expect(capturedOptions.submitUserSpeechOnPause).toBe(false);
    await expect(capturedOptions.getStream?.()).resolves.toBe(
      existingMic.stream,
    );
    await expect(
      capturedOptions.resumeStream?.(existingMic.stream),
    ).resolves.toBe(existingMic.stream);
    await expect(
      capturedOptions.pauseStream?.(existingMic.stream),
    ).resolves.toBeUndefined();
    expect(fakeVad.startCalls).toBe(1);
    expect(existingMic.stopCalls).toBe(0);
  });

  it('maps the owned asset base URL and forwards provider options', async () => {
    const existingMic = makeStream();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      assetBaseUrl: '/self-hosted/vad',
      providerOptions: {
        model: 'v5',
        positiveSpeechThreshold: 0.8,
      },
    });

    await controller.start();

    expect(getCapturedOptions()).toMatchObject({
      baseAssetPath: '/self-hosted/vad/',
      onnxWASMBasePath: '/self-hosted/vad/',
      model: 'v5',
      positiveSpeechThreshold: 0.8,
    });
  });

  it('overrides provider options for Maelstrom-owned lifecycle and speech hooks', async () => {
    const existingMic = makeStream();
    const providerGetStream = async () => existingMic.stream;
    const providerOnSpeechStart = async () => {};
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      providerOptions: {
        baseAssetPath: '/unsafe/',
        onnxWASMBasePath: '/unsafe/',
        audioContext: {} as AudioContext,
        startOnLoad: true,
        submitUserSpeechOnPause: true,
        getStream: providerGetStream,
        onSpeechStart: providerOnSpeechStart,
      },
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();

    expect(capturedOptions.baseAssetPath).toBe('/vad-web/');
    expect(capturedOptions.onnxWASMBasePath).toBe('/vad-web/');
    expect(capturedOptions.audioContext).toBeUndefined();
    expect(capturedOptions.startOnLoad).toBe(false);
    expect(capturedOptions.submitUserSpeechOnPause).toBe(false);
    expect(capturedOptions.getStream).not.toBe(providerGetStream);
    expect(capturedOptions.onSpeechStart).not.toBe(providerOnSpeechStart);
  });

  it('serializes duplicate speech callbacks into exactly one turn start and one turn end', async () => {
    const existingMic = makeStream();
    const turns = makeTurnControl();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: turns.turnControl,
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();
    await capturedOptions.onSpeechStart?.();
    await capturedOptions.onSpeechStart?.();
    await capturedOptions.onSpeechEnd?.(new Float32Array([1, 2, 3]));
    await capturedOptions.onSpeechEnd?.(new Float32Array([4, 5, 6]));

    expect(turns.startCalls).toBe(1);
    expect(turns.endCalls).toBe(1);
  });

  it('ignores out-of-order speech-end callbacks until speech has started', async () => {
    const existingMic = makeStream();
    const turns = makeTurnControl();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: turns.turnControl,
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();
    await capturedOptions.onSpeechEnd?.(new Float32Array([1]));
    await capturedOptions.onSpeechStart?.();
    await capturedOptions.onSpeechEnd?.(new Float32Array([2]));

    expect(turns.startCalls).toBe(1);
    expect(turns.endCalls).toBe(1);
  });

  it('queues a speech end behind an in-flight speech start instead of racing callbacks', async () => {
    const existingMic = makeStream();
    const start = deferred<void>();
    let startCalls = 0;
    let endCalls = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: {
        async startTurn() {
          startCalls += 1;
          await start.promise;
        },
        async endTurn() {
          endCalls += 1;
        },
      },
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();
    const startCallback = capturedOptions.onSpeechStart?.();
    const endCallback = capturedOptions.onSpeechEnd?.(new Float32Array([1]));

    expect(startCalls).toBe(1);
    expect(endCalls).toBe(0);

    start.resolve();
    await startCallback;
    await endCallback;

    expect(startCalls).toBe(1);
    expect(endCalls).toBe(1);
  });

  it('falls back to manual turn control when initialization fails and reports the error', async () => {
    const initError = new Error('vad assets unavailable');
    const existingMic = makeStream();
    const { controller, errors } = makeControllerFixture({
      mic: existingMic.stream,
      loadError: initError,
    });

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.state.mode).toBe('manual_fallback');
    expect(controller.state.error).toBe(initError);
    expect(errors).toEqual([initError]);
  });

  it('falls back to manual turn control when a VAD callback operation fails without throwing through the callback', async () => {
    const callbackError = new Error('start failed');
    const existingMic = makeStream();
    const { controller, getCapturedOptions, errors } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: {
        async startTurn() {
          throw callbackError;
        },
        async endTurn() {},
      },
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();
    await expect(capturedOptions.onSpeechStart?.()).resolves.toBeUndefined();

    expect(controller.state.mode).toBe('manual_fallback');
    expect(controller.state.error).toBe(callbackError);
    expect(errors).toEqual([callbackError]);
  });

  it('pauses VAD and suppresses every speech callback after fallback', async () => {
    const callbackError = new Error('start failed');
    const existingMic = makeStream();
    let startCalls = 0;
    let endCalls = 0;
    const { controller, fakeVad, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: {
        async startTurn() {
          startCalls += 1;
          throw callbackError;
        },
        async endTurn() {
          endCalls += 1;
        },
      },
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();
    await capturedOptions.onSpeechStart?.();
    await capturedOptions.onSpeechStart?.();
    await capturedOptions.onSpeechEnd?.(new Float32Array([1]));

    expect(controller.state.mode).toBe('manual_fallback');
    expect(fakeVad.pauseCalls).toBe(1);
    expect(startCalls).toBe(1);
    expect(endCalls).toBe(0);
    expect(existingMic.stopCalls).toBe(0);
  });

  it('cleans up safely when destroyed during partial initialization', async () => {
    const existingMic = makeStream();
    const fakeVad = makeFakeVad();
    const createdVad = deferred<void>();
    const allowVadCreation = deferred<void>();
    const controller = createBrowserVadController({
      session: { getAudioStreams: () => ({ mic: existingMic.stream }) },
      turnControl: makeTurnControl().turnControl,
      onError: () => {},
      loadMicVAD: async () => ({
        new: async () => {
          await allowVadCreation.promise;
          createdVad.resolve();
          return fakeVad;
        },
      }),
    });

    const starting = controller.start();
    const destroying = controller.destroy();
    allowVadCreation.resolve();

    await createdVad.promise;
    await starting;
    await destroying;

    expect(fakeVad.startCalls).toBe(0);
    expect(fakeVad.destroyCalls).toBe(1);
    expect(existingMic.stopCalls).toBe(0);
    expect(controller.state.mode).toBe('manual_fallback');
  });

  it('pauses and destroys VAD without stopping shared media tracks', async () => {
    const existingMic = makeStream();
    const { controller, fakeVad } = makeControllerFixture({
      mic: existingMic.stream,
    });

    await controller.start();
    await controller.pause();
    await controller.destroy();
    await controller.destroy();

    expect(fakeVad.pauseCalls).toBe(1);
    expect(fakeVad.destroyCalls).toBe(1);
    expect(existingMic.stopCalls).toBe(0);
  });

  it('resumes the existing VAD instance after a pause', async () => {
    const existingMic = makeStream();
    const { controller, fakeVad } = makeControllerFixture({
      mic: existingMic.stream,
    });

    await controller.start();
    await controller.pause();
    await controller.start();

    expect(fakeVad.startCalls).toBe(2);
    expect(controller.state.mode).toBe('active');
  });

  it('keeps the latest lifecycle request active when reconnect follows a delayed pause', async () => {
    const existingMic = makeStream();
    const delayed = makeDelayedPauseVad();
    const controller = createBrowserVadController({
      session: { getAudioStreams: () => ({ mic: existingMic.stream }) },
      turnControl: makeTurnControl().turnControl,
      onError: () => {},
      assetBaseUrl: '/vad-web/',
      loadMicVAD: async () => ({
        new: async () => delayed.fakeVad,
      }),
    });

    await controller.start();
    const pausing = controller.pause();
    const restarting = controller.start();

    expect(delayed.fakeVad.startCalls).toBe(1);
    delayed.releasePause();
    await pausing;
    await restarting;

    expect(delayed.fakeVad.startCalls).toBe(2);
    expect(controller.state.mode).toBe('active');
  });

  it('rejects foreign asset origins before loading VAD code', async () => {
    let loadCalls = 0;
    const controller = createBrowserVadController({
      session: { getAudioStreams: () => ({}) },
      turnControl: makeTurnControl().turnControl,
      onError: () => {},
      assetBaseUrl: 'https://assets.example.test/vad/',
      loadMicVAD: async () => {
        loadCalls += 1;
        throw new Error('should not load');
      },
    });

    await controller.start();

    expect(loadCalls).toBe(0);
    expect(controller.state.mode).toBe('manual_fallback');
    expect(controller.state.error).toMatchObject({
      message: expect.stringContaining('same-origin'),
    });
  });

  it('strips executable provider configuration at runtime', async () => {
    const existingMic = makeStream();
    const providerGetStream = async () => existingMic.stream;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      providerOptions: {
        model: 'v5',
        ortConfig: { wasmPaths: '/unsafe/' },
        startOnLoad: true,
        getStream: providerGetStream,
      },
    });

    await controller.start();

    expect(getCapturedOptions().model).toBe('v5');
    expect(getCapturedOptions().ortConfig).toBeUndefined();
    expect(getCapturedOptions().startOnLoad).toBe(false);
    expect(getCapturedOptions().getStream).not.toBe(providerGetStream);
  });
});
