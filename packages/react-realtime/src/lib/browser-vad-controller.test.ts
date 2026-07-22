import { describe, expect, it } from "bun:test";

import { createBrowserVadController } from "./browser-vad-controller.js";

type AdapterTurnControl = {
  startTurn(): Promise<void>;
  endTurn(): Promise<void>;
};

type AdapterAutomaticTurnControl = {
  isAvailable(): boolean;
  createHandle?(): Pick<AdapterAutomaticTurnControl, "startTurn" | "endTurn">;
  startTurn(options: { preRollMs: number }): Promise<void>;
  endTurn(): Promise<void>;
};

type CapturedVadOptions = {
  audioContext?: AudioContext;
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  model?: "legacy" | "v5";
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

function makeAutomaticTurnControl(
  turnControl: AdapterTurnControl = makeTurnControl().turnControl,
): AdapterAutomaticTurnControl {
  const automaticTurnControl: AdapterAutomaticTurnControl = {
    isAvailable: () => true,
    createHandle: () => automaticTurnControl,
    startTurn: () => turnControl.startTurn(),
    endTurn: () => turnControl.endTurn(),
  };
  return automaticTurnControl;
}

function makeControllerFixture(
  options: {
    readonly mic?: MediaStream;
    readonly turnControl?: AdapterTurnControl;
    readonly automaticTurnControl?: AdapterAutomaticTurnControl | null;
    readonly loadError?: unknown;
    readonly assetBaseUrl?: string;
    readonly providerOptions?: Record<string, unknown>;
    readonly preRollMs?: number;
  } = {},
) {
  const fakeVad = makeFakeVad();
  const errors: unknown[] = [];
  let capturedOptions: CapturedVadOptions | undefined;
  const turnControl = options.turnControl ?? makeTurnControl().turnControl;
  const configuredAutomaticTurnControl =
    options.automaticTurnControl === null
      ? undefined
      : (options.automaticTurnControl ?? {
          isAvailable: () => true,
          startTurn: () => turnControl.startTurn(),
          endTurn: () => turnControl.endTurn(),
        });
  const automaticTurnControl = configuredAutomaticTurnControl
    ? {
        ...configuredAutomaticTurnControl,
        createHandle:
          configuredAutomaticTurnControl.createHandle ??
          (() => configuredAutomaticTurnControl),
      }
    : undefined;
  const controller = createBrowserVadController({
    session: { getAudioStreams: () => ({ mic: options.mic }) },
    automaticTurnControl,
    onError: (error: unknown) => errors.push(error),
    assetBaseUrl: options.assetBaseUrl ?? "/vad-web/",
    providerOptions: options.providerOptions,
    preRollMs: options.preRollMs,
    loadMicVAD: async () => {
      if (options.loadError) throw options.loadError;
      return {
        new: async (vadOptions?: unknown) => {
          capturedOptions = (vadOptions ?? {}) as CapturedVadOptions;
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
      if (!capturedOptions) throw new Error("MicVAD.new was not called");
      return capturedOptions;
    },
  };
}

describe("createBrowserVadController", () => {
  it("initializes MicVAD with the existing session mic and LiveKit-safe stream lifecycle hooks", async () => {
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

  it("maps the owned asset base URL and forwards provider options", async () => {
    const existingMic = makeStream();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      assetBaseUrl: "/self-hosted/vad",
      providerOptions: {
        model: "v5",
        positiveSpeechThreshold: 0.8,
      },
    });

    await controller.start();

    expect(getCapturedOptions()).toMatchObject({
      baseAssetPath: "/self-hosted/vad/",
      onnxWASMBasePath: "/self-hosted/vad/",
      model: "v5",
      positiveSpeechThreshold: 0.8,
    });
  });

  const acceptedAssetDirectories = [
    {
      name: "relative directory",
      configured: "/self-hosted/vad///",
      normalized: "/self-hosted/vad/",
    },
    {
      name: "absolute HTTPS CDN directory",
      configured: "https://cdn.example.test/vad///",
      normalized: "https://cdn.example.test/vad/",
    },
  ] as const;

  for (const testCase of acceptedAssetDirectories) {
    it(`accepts and normalizes an operator-configured ${testCase.name}`, async () => {
      const existingMic = makeStream();
      const { controller, getCapturedOptions } = makeControllerFixture({
        mic: existingMic.stream,
        assetBaseUrl: testCase.configured,
      });

      await controller.start();

      expect(getCapturedOptions().baseAssetPath).toBe(testCase.normalized);
      expect(getCapturedOptions().onnxWASMBasePath).toBe(testCase.normalized);
      expect(controller.state.mode).toBe("active");
    });
  }

  const rejectedAssetDirectories = [
    { name: "HTTP URL", configured: "http://cdn.example.test/vad/" },
    { name: "protocol-relative URL", configured: "//cdn.example.test/vad/" },
    {
      name: "URL containing credentials",
      configured: "https://user:secret@cdn.example.test/vad/",
    },
    {
      name: "URL containing a query",
      configured: "https://cdn.example.test/vad/?version=1",
    },
    {
      name: "URL containing a fragment",
      configured: "https://cdn.example.test/vad/#files",
    },
    { name: "malformed URL", configured: "https://[" },
    { name: "non-HTTPS scheme", configured: "ftp://cdn.example.test/vad/" },
  ] as const;

  for (const testCase of rejectedAssetDirectories) {
    it(`retains manual fallback for an operator-configured ${testCase.name}`, async () => {
      let loadCalls = 0;
      const errors: unknown[] = [];
      const controller = createBrowserVadController({
        session: { getAudioStreams: () => ({}) },
        automaticTurnControl: makeAutomaticTurnControl(),
        onError: (error) => errors.push(error),
        assetBaseUrl: testCase.configured,
        loadMicVAD: async () => {
          loadCalls += 1;
          throw new Error("should not load");
        },
      });

      await controller.start();

      expect(loadCalls).toBe(0);
      expect(controller.state.mode).toBe("manual_fallback");
      expect(controller.state.error).toBeInstanceOf(Error);
      expect(errors).toEqual([controller.state.error]);
    });
  }

  it("overrides provider options for Maelstrom-owned lifecycle and speech hooks", async () => {
    const existingMic = makeStream();
    const providerGetStream = async () => existingMic.stream;
    const providerOnSpeechStart = async () => {};
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      providerOptions: {
        baseAssetPath: "/unsafe/",
        onnxWASMBasePath: "/unsafe/",
        audioContext: {} as AudioContext,
        startOnLoad: true,
        submitUserSpeechOnPause: true,
        getStream: providerGetStream,
        onSpeechStart: providerOnSpeechStart,
      },
    });

    await controller.start();
    const capturedOptions = getCapturedOptions();

    expect(capturedOptions.baseAssetPath).toBe("/vad-web/");
    expect(capturedOptions.onnxWASMBasePath).toBe("/vad-web/");
    expect(capturedOptions.audioContext).toBeUndefined();
    expect(capturedOptions.startOnLoad).toBe(false);
    expect(capturedOptions.submitUserSpeechOnPause).toBe(false);
    expect(capturedOptions.getStream).not.toBe(providerGetStream);
    expect(capturedOptions.onSpeechStart).not.toBe(providerOnSpeechStart);
  });

  it("serializes duplicate speech callbacks into exactly one turn start and one turn end", async () => {
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

  it("uses automatic turn control with bounded pre-roll without opening a manual turn", async () => {
    const existingMic = makeStream();
    const manual = makeTurnControl();
    const automaticStarts: number[] = [];
    let automaticEnds = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: manual.turnControl,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn({ preRollMs }) {
          automaticStarts.push(preRollMs);
        },
        async endTurn() {
          automaticEnds += 1;
        },
      },
    });

    await controller.start();
    await getCapturedOptions().onSpeechStart?.();
    await getCapturedOptions().onSpeechEnd?.(new Float32Array([1]));

    expect(automaticStarts).toEqual([250]);
    expect(automaticEnds).toBe(1);
    expect(manual.startCalls).toBe(0);
    expect(manual.endCalls).toBe(0);
  });

  it("falls back to manual mode when automatic turn control is unavailable", async () => {
    const existingMic = makeStream();
    const manual = makeTurnControl();
    const { controller, errors } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: manual.turnControl,
      automaticTurnControl: null,
    });

    await controller.start();

    expect(controller.state.mode).toBe("manual_fallback");
    expect(errors[0]).toMatchObject({
      message: expect.stringContaining("automatic turn"),
    });
    expect(manual.startCalls).toBe(0);
  });

  it("falls back to manual mode when automatic turn initialization failed", async () => {
    const existingMic = makeStream();
    const manual = makeTurnControl();
    const initError = new Error("audio worklet unavailable");
    const { controller, getCapturedOptions, errors } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: manual.turnControl,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {
          throw initError;
        },
        async endTurn() {},
      },
    });

    await controller.start();
    await getCapturedOptions().onSpeechStart?.();

    expect(controller.state.mode).toBe("manual_fallback");
    expect(errors).toEqual([initError]);
    expect(manual.startCalls).toBe(0);
  });

  it("clamps configured transport pre-roll to the safe adapter bound", async () => {
    const existingMic = makeStream();
    const requested: number[] = [];
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      preRollMs: 5_000,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn({ preRollMs }) {
          requested.push(preRollMs);
        },
        async endTurn() {},
      },
    });

    await controller.start();
    await getCapturedOptions().onSpeechStart?.();

    expect(requested).toEqual([500]);
  });

  it("ignores out-of-order speech-end callbacks until speech has started", async () => {
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

  it("queues a speech end behind an in-flight speech start instead of racing callbacks", async () => {
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

  it("preserves the next start and end while the prior start and requested end are pending", async () => {
    const existingMic = makeStream();
    const firstStart = deferred<void>();
    const boundaries: string[] = [];
    let startCalls = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {
          startCalls += 1;
          boundaries.push("start");
          if (startCalls === 1) await firstStart.promise;
        },
        async endTurn() {
          boundaries.push("end");
        },
      },
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    const firstStarting = callbacks.onSpeechStart?.();
    const firstEnding = callbacks.onSpeechEnd?.(new Float32Array([1]));
    const secondStarting = callbacks.onSpeechStart?.();
    const secondEnding = callbacks.onSpeechEnd?.(new Float32Array([2]));

    expect(boundaries).toEqual(["start"]);

    firstStart.resolve();
    await Promise.all([
      firstStarting,
      firstEnding,
      secondStarting,
      secondEnding,
    ]);

    expect(boundaries).toEqual(["start", "end", "start", "end"]);
  });

  it("starts the next turn only after the prior turn finishes ending", async () => {
    const existingMic = makeStream();
    const firstEnd = deferred<void>();
    const boundaries: string[] = [];
    let endCalls = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {
          boundaries.push("start");
        },
        async endTurn() {
          endCalls += 1;
          boundaries.push("end");
          if (endCalls === 1) await firstEnd.promise;
        },
      },
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    await callbacks.onSpeechStart?.();
    const ending = callbacks.onSpeechEnd?.(new Float32Array([1]));
    await Promise.resolve();
    const nextStart = callbacks.onSpeechStart?.();

    expect(boundaries).toEqual(["start", "end"]);

    firstEnd.resolve();
    await ending;
    await nextStart;

    expect(boundaries).toEqual(["start", "end", "start"]);
  });

  it("ends a pending next turn when speech ends before the prior turn finishes ending", async () => {
    const existingMic = makeStream();
    const firstEnd = deferred<void>();
    const boundaries: string[] = [];
    let endCalls = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {
          boundaries.push("start");
        },
        async endTurn() {
          endCalls += 1;
          boundaries.push("end");
          if (endCalls === 1) await firstEnd.promise;
        },
      },
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    await callbacks.onSpeechStart?.();
    const ending = callbacks.onSpeechEnd?.(new Float32Array([1]));
    await Promise.resolve();
    const nextStart = callbacks.onSpeechStart?.();
    const duplicateNextStart = callbacks.onSpeechStart?.();
    const nextEnd = callbacks.onSpeechEnd?.(new Float32Array([2]));
    const duplicateNextEnd = callbacks.onSpeechEnd?.(new Float32Array([3]));

    expect(boundaries).toEqual(["start", "end"]);

    firstEnd.resolve();
    await ending;
    await nextStart;
    await duplicateNextStart;
    await nextEnd;
    await duplicateNextEnd;

    expect(boundaries).toEqual(["start", "end", "start", "end"]);

    await callbacks.onSpeechStart?.();
    await callbacks.onSpeechEnd?.(new Float32Array([4]));
    expect(boundaries).toEqual([
      "start",
      "end",
      "start",
      "end",
      "start",
      "end",
    ]);
  });

  it("falls back to manual turn control when initialization fails and reports the error", async () => {
    const initError = new Error("vad assets unavailable");
    const existingMic = makeStream();
    const { controller, errors } = makeControllerFixture({
      mic: existingMic.stream,
      loadError: initError,
    });

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.state.mode).toBe("manual_fallback");
    expect(controller.state.error).toBe(initError);
    expect(errors).toEqual([initError]);
  });

  it("falls back to manual turn control when a VAD callback operation fails without throwing through the callback", async () => {
    const callbackError = new Error("start failed");
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

    expect(controller.state.mode).toBe("manual_fallback");
    expect(controller.state.error).toBe(callbackError);
    expect(errors).toEqual([callbackError]);
  });

  it("does not finalize a turn twice when the adapter reports an error after finalization", async () => {
    const existingMic = makeStream();
    const drainError = new Error("pre-roll drain failed");
    let endCalls = 0;
    const { controller, getCapturedOptions, errors } = makeControllerFixture({
      mic: existingMic.stream,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {},
        async endTurn() {
          endCalls += 1;
          throw Object.assign(
            new Error("automatic turn finalized with error"),
            {
              cause: drainError,
              turnFinalized: true as const,
            },
          );
        },
      },
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    await callbacks.onSpeechStart?.();
    await callbacks.onSpeechEnd?.(new Float32Array([1]));

    expect(controller.state.mode).toBe("manual_fallback");
    expect(errors).toHaveLength(1);

    await controller.pause();

    expect(endCalls).toBe(1);
  });

  it("pauses VAD and suppresses every speech callback after fallback", async () => {
    const callbackError = new Error("start failed");
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

    expect(controller.state.mode).toBe("manual_fallback");
    expect(fakeVad.pauseCalls).toBe(1);
    expect(startCalls).toBe(1);
    expect(endCalls).toBe(0);
    expect(existingMic.stopCalls).toBe(0);
  });

  it("cleans up safely when destroyed during partial initialization", async () => {
    const existingMic = makeStream();
    const fakeVad = makeFakeVad();
    const createdVad = deferred<void>();
    const allowVadCreation = deferred<void>();
    const controller = createBrowserVadController({
      session: { getAudioStreams: () => ({ mic: existingMic.stream }) },
      automaticTurnControl: makeAutomaticTurnControl(),
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
    expect(controller.state.mode).toBe("manual_fallback");
  });

  it("pauses and destroys VAD without stopping shared media tracks", async () => {
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

  it("resumes the existing VAD instance after a pause", async () => {
    const existingMic = makeStream();
    const { controller, fakeVad } = makeControllerFixture({
      mic: existingMic.stream,
    });

    await controller.start();
    await controller.pause();
    await controller.start();

    expect(fakeVad.startCalls).toBe(2);
    expect(controller.state.mode).toBe("active");
  });

  it("fences callbacks from a retired mic generation and completes the first turn on its replacement", async () => {
    const micA = makeStream();
    const micB = makeStream();
    const turns = makeTurnControl();
    const first = makeControllerFixture({
      mic: micA.stream,
      turnControl: turns.turnControl,
    });
    const second = makeControllerFixture({
      mic: micB.stream,
      turnControl: turns.turnControl,
    });

    await first.controller.start();
    const staleCallbacks = first.getCapturedOptions();
    await first.controller.destroy();
    await second.controller.start();

    await staleCallbacks.onSpeechStart?.();
    await staleCallbacks.onSpeechEnd?.(new Float32Array([1]));
    const replacementCallbacks = second.getCapturedOptions();
    await expect(replacementCallbacks.getStream?.()).resolves.toBe(micB.stream);
    await replacementCallbacks.onSpeechStart?.();
    await replacementCallbacks.onSpeechEnd?.(new Float32Array([2]));

    expect(turns.startCalls).toBe(1);
    expect(turns.endCalls).toBe(1);
  });

  it("closes a fully started automatic turn once on pause and completes the next turn after resume", async () => {
    const existingMic = makeStream();
    const turns = makeTurnControl();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: turns.turnControl,
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    await callbacks.onSpeechStart?.();

    await controller.pause();

    expect(turns.startCalls).toBe(1);
    expect(turns.endCalls).toBe(1);

    await controller.start();
    await callbacks.onSpeechStart?.();
    await callbacks.onSpeechEnd?.(new Float32Array([1]));

    expect(turns.startCalls).toBe(2);
    expect(turns.endCalls).toBe(2);
  });

  it("ignores a stale speech end received after pause begins without closing the resumed turn", async () => {
    const existingMic = makeStream();
    const turns = makeTurnControl();
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      turnControl: turns.turnControl,
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    await callbacks.onSpeechStart?.();

    const pausing = controller.pause();
    const staleEnd = callbacks.onSpeechEnd?.(new Float32Array([1]));
    const restarting = controller.start();
    await pausing;
    await staleEnd;
    await restarting;

    expect(turns.endCalls).toBe(1);

    await callbacks.onSpeechStart?.();
    expect(turns.startCalls).toBe(2);
    expect(turns.endCalls).toBe(1);

    await callbacks.onSpeechEnd?.(new Float32Array([2]));
    expect(turns.endCalls).toBe(2);
  });

  it("keeps the latest lifecycle request active when reconnect follows a delayed pause", async () => {
    const existingMic = makeStream();
    const delayed = makeDelayedPauseVad();
    const controller = createBrowserVadController({
      session: { getAudioStreams: () => ({ mic: existingMic.stream }) },
      automaticTurnControl: makeAutomaticTurnControl(),
      onError: () => {},
      assetBaseUrl: "/vad-web/",
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
    expect(controller.state.mode).toBe("active");
  });

  it("fences an in-flight speech start across pause and restarts with one fresh turn", async () => {
    const existingMic = makeStream();
    const firstStart = deferred<void>();
    let startCalls = 0;
    let endCalls = 0;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      automaticTurnControl: {
        isAvailable: () => true,
        async startTurn() {
          startCalls += 1;
          if (startCalls === 1) await firstStart.promise;
        },
        async endTurn() {
          endCalls += 1;
        },
      },
    });

    await controller.start();
    const callbacks = getCapturedOptions();
    const staleStart = callbacks.onSpeechStart?.();
    const pausing = controller.pause();
    const restarting = controller.start();

    firstStart.resolve();
    await staleStart;
    await pausing;
    await restarting;

    expect(startCalls).toBe(1);
    expect(endCalls).toBe(1);

    await callbacks.onSpeechStart?.();
    await callbacks.onSpeechEnd?.(new Float32Array([1]));

    expect(startCalls).toBe(2);
    expect(endCalls).toBe(2);
    expect(controller.state.mode).toBe("active");
  });

  it("strips executable provider configuration at runtime", async () => {
    const existingMic = makeStream();
    const providerGetStream = async () => existingMic.stream;
    const { controller, getCapturedOptions } = makeControllerFixture({
      mic: existingMic.stream,
      providerOptions: {
        model: "v5",
        ortConfig: { wasmPaths: "/unsafe/" },
        startOnLoad: true,
        getStream: providerGetStream,
      },
    });

    await controller.start();

    expect(getCapturedOptions().model).toBe("v5");
    expect(getCapturedOptions().ortConfig).toBeUndefined();
    expect(getCapturedOptions().startOnLoad).toBe(false);
    expect(getCapturedOptions().getStream).not.toBe(providerGetStream);
  });
});
