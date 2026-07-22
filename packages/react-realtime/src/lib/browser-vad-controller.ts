import type {
  AdapterAudioStreams,
  AdapterAutomaticTurnControl,
} from "@maelstrom-co/realtime";
import type { RealTimeVADOptions } from "@ricky0123/vad-web";

import type { BrowserVadProviderOptions } from "./maelstrom-realtime.js";

type MicVAD = {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

type MicVADFactory = {
  new: (options?: Partial<RealTimeVADOptions>) => Promise<MicVAD>;
};

type BrowserVadControllerOptions = {
  readonly session: { getAudioStreams(): AdapterAudioStreams };
  /** Adapter-owned automatic boundary control; absence forces manual fallback. */
  readonly automaticTurnControl?: AdapterAutomaticTurnControl;
  readonly onError: (error: unknown) => void;
  readonly assetBaseUrl?: string;
  readonly providerOptions?: BrowserVadProviderOptions;
  /** Browser-local transport tail requested at automatic speech start. */
  readonly preRollMs?: number;
  readonly loadMicVAD?: () => Promise<MicVADFactory>;
};

type AutomaticTurnHandle = Pick<
  AdapterAutomaticTurnControl,
  "startTurn" | "endTurn"
>;

/** Browser VAD lifecycle; manual fallback keeps push-to-talk available. */
export type BrowserVadControllerState =
  | { readonly mode: "idle"; readonly error?: undefined }
  | { readonly mode: "active"; readonly error?: undefined }
  | { readonly mode: "manual_fallback"; readonly error: unknown };

/** Controls for the browser-owned VAD instance. */
export type BrowserVadController = {
  readonly state: BrowserVadControllerState;
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

async function loadMicVAD(): Promise<MicVADFactory> {
  const module = await import("@ricky0123/vad-web");
  return module.MicVAD;
}

/**
 * Creates a VAD controller that reuses the adapter's mic stream.
 *
 * The controller owns VAD lifecycle only; Maelstrom does not intentionally stop
 * the adapter's shared media tracks during VAD teardown.
 * Missing pre-roll capability, initialization failures, and callback failures
 * are reported through `onError` and transition to `manual_fallback` instead of
 * opening an unbuffered automatic turn or escaping into the React layer.
 * Initialization captures one connection-bound automatic-turn handle; all
 * later callbacks and cleanup use that handle, so a delayed pause from a
 * retired controller cannot close a replacement connection's turn.
 * Pausing fences pending speech callbacks and closes any automatic turn that
 * started before the same controller is resumed.
 * Speech boundaries are serialized; while a turn is ending, one idempotent
 * next start and its matching end remain pending until that boundary closes.
 */
export function createBrowserVadController(
  options: BrowserVadControllerOptions,
): BrowserVadController {
  let state: BrowserVadControllerState = { mode: "idle" };
  let vad: MicVAD | undefined;
  let automaticTurnHandle: AutomaticTurnHandle | undefined;
  let destroyed = false;
  let speechActive = false;
  let speechStarting = false;
  let speechEnding = false;
  let endRequested = false;
  let callbacksEnabled = true;
  let pauseRequested = false;
  let speechGeneration = 0;
  let startedTurnGeneration: number | undefined;
  let queue = Promise.resolve();
  let pendingNextStart: Promise<void> | undefined;
  let pendingNextEnd: Promise<void> | undefined;
  let fallbackPause: Promise<void> | undefined;
  let destroyRequested = false;
  let lifecycleSequence = 0;
  let destroySequence = Number.POSITIVE_INFINITY;
  let destroyPromise: Promise<void> | undefined;

  const setFallback = (error: unknown) => {
    if (!callbacksEnabled && state.mode === "manual_fallback")
      return fallbackPause;
    callbacksEnabled = false;
    state = { mode: "manual_fallback", error };
    fallbackPause = enqueue(async () => {
      await vad?.pause();
    }).catch(() => undefined);
    try {
      options.onError(error);
    } catch {
      // Error reporting must not turn a recoverable VAD failure into a callback rejection.
    }
    return fallbackPause;
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  };

  const beginTurn = async (generation: number) => {
    speechStarting = true;
    try {
      if (!automaticTurnHandle) {
        throw new Error("The adapter does not support automatic turn pre-roll");
      }
      await automaticTurnHandle.startTurn({
        preRollMs: normalizePreRollMs(options.preRollMs),
      });
      startedTurnGeneration = generation;
      if (!destroyed && generation === speechGeneration) speechActive = true;
    } finally {
      if (generation === speechGeneration) speechStarting = false;
    }
  };

  const finishTurn = async (generation: number) => {
    if (startedTurnGeneration !== generation || destroyed) return;
    if (generation === speechGeneration) speechEnding = true;
    try {
      if (!automaticTurnHandle) return;
      try {
        await automaticTurnHandle.endTurn();
      } catch (error) {
        if (isFinalizedAutomaticTurnError(error)) {
          if (startedTurnGeneration === generation)
            startedTurnGeneration = undefined;
          if (generation === speechGeneration) speechActive = false;
        }
        throw error;
      }
      if (startedTurnGeneration === generation)
        startedTurnGeneration = undefined;
      if (generation === speechGeneration) speechActive = false;
    } finally {
      if (generation === speechGeneration) speechEnding = false;
    }
  };

  const startSpeech = () => {
    if (
      !callbacksEnabled ||
      pauseRequested ||
      state.mode !== "active" ||
      destroyed
    )
      return Promise.resolve();

    if (endRequested || speechEnding) {
      if (pendingNextStart) return pendingNextStart;
      const generation = speechGeneration;
      const scheduled = enqueue(async () => {
        if (
          !callbacksEnabled ||
          pauseRequested ||
          state.mode !== "active" ||
          destroyed ||
          generation !== speechGeneration
        )
          return;
        await beginTurn(generation);
      }).catch((error) => {
        if (generation !== speechGeneration) return;
        return setFallback(error);
      });
      const pending = scheduled.finally(() => {
        if (pendingNextStart === pending) pendingNextStart = undefined;
      });
      pendingNextStart = pending;
      return pending;
    }

    if (speechStarting) return Promise.resolve();
    if (speechActive) return Promise.resolve();
    const generation = speechGeneration;
    const startPromise = beginTurn(generation);
    return enqueue(async () => {
      await startPromise;
    }).catch((error) => {
      if (generation !== speechGeneration) return;
      return setFallback(error);
    });
  };

  const endSpeech = () => {
    if (!callbacksEnabled || state.mode !== "active") {
      return Promise.resolve();
    }
    if (pendingNextStart) {
      if (pendingNextEnd) return pendingNextEnd;
      const generation = speechGeneration;
      const scheduled = enqueue(async () => {
        if (
          !callbacksEnabled ||
          state.mode !== "active" ||
          startedTurnGeneration !== generation ||
          destroyed
        )
          return;
        await finishTurn(generation);
      }).catch((error) => {
        if (generation !== speechGeneration) return;
        return setFallback(error);
      });
      const pending = scheduled.finally(() => {
        if (pendingNextEnd === pending) pendingNextEnd = undefined;
      });
      pendingNextEnd = pending;
      return pending;
    }
    if (endRequested || speechEnding || (!speechActive && !speechStarting)) {
      return Promise.resolve();
    }
    const generation = speechGeneration;
    endRequested = true;
    return enqueue(async () => {
      if (generation === speechGeneration) endRequested = false;
      await finishTurn(generation);
    }).catch((error) => {
      if (generation !== speechGeneration) return;
      endRequested = false;
      speechEnding = false;
      return setFallback(error);
    });
  };

  const initialize = async () => {
    try {
      const automaticTurnControl = options.automaticTurnControl;
      if (
        !automaticTurnControl?.isAvailable() ||
        !automaticTurnControl.createHandle
      ) {
        throw new Error("The adapter does not support automatic turn pre-roll");
      }
      automaticTurnHandle = automaticTurnControl.createHandle();
      const assetBaseUrl = normalizeAssetBaseUrl(options.assetBaseUrl);
      const MicVADConstructor = await (options.loadMicVAD?.() ?? loadMicVAD());
      const providerOptions = {
        ...(options.providerOptions as Record<string, unknown> | undefined),
      } as Partial<RealTimeVADOptions>;
      delete (providerOptions as { ortConfig?: unknown }).ortConfig;
      vad = await MicVADConstructor.new({
        ...providerOptions,
        audioContext: undefined,
        baseAssetPath: assetBaseUrl,
        onnxWASMBasePath: assetBaseUrl,
        startOnLoad: false,
        getStream: async () => {
          const mic = options.session.getAudioStreams().mic;
          if (!mic)
            throw new Error(
              "A shared microphone stream is required for browser VAD",
            );
          return mic;
        },
        pauseStream: async () => {},
        resumeStream: async (stream: MediaStream) => stream,
        submitUserSpeechOnPause: false,
        onSpeechStart: startSpeech,
        onSpeechEnd: endSpeech,
        onVADMisfire: () => {},
        onSpeechRealStart: () => {},
        onFrameProcessed: () => {},
      });
      if (destroyRequested || destroyed) {
        await vad?.destroy();
        vad = undefined;
        return;
      }
      await vad?.start();
      if (callbacksEnabled) {
        pauseRequested = false;
        state = { mode: "active" };
      }
    } catch (error) {
      if (!destroyed && !destroyRequested) setFallback(error);
    }
  };

  const start = () => {
    const request = ++lifecycleSequence;
    return enqueue(async () => {
      if (
        destroyed ||
        request > destroySequence ||
        state.mode === "active" ||
        state.mode === "manual_fallback"
      )
        return;
      if (vad) {
        try {
          await vad.start();
          if (!destroyed && callbacksEnabled) {
            pauseRequested = false;
            state = { mode: "active" };
          }
        } catch (error) {
          if (!destroyed) setFallback(error);
        }
        return;
      }
      await initialize();
    });
  };

  const pause = () => {
    const pausedGeneration = speechGeneration++;
    pauseRequested = true;
    speechActive = false;
    speechStarting = false;
    speechEnding = false;
    endRequested = false;
    return enqueue(async () => {
      const currentVad = vad;
      if (!currentVad || destroyed) return;
      try {
        await currentVad.pause();
        if (startedTurnGeneration === pausedGeneration) {
          await automaticTurnHandle?.endTurn();
          if (startedTurnGeneration === pausedGeneration)
            startedTurnGeneration = undefined;
        }
        if (!destroyed && state.mode !== "manual_fallback")
          state = { mode: "idle" };
      } catch (error) {
        setFallback(error);
      }
    });
  };

  return {
    get state() {
      return state;
    },
    start,
    pause,
    destroy() {
      if (destroyPromise) return destroyPromise;
      destroyRequested = true;
      destroySequence = ++lifecycleSequence;
      destroyPromise = enqueue(async () => {
        destroyed = true;
        callbacksEnabled = false;
        pauseRequested = true;
        const currentVad = vad;
        if (currentVad) {
          try {
            await currentVad.destroy();
          } catch (error) {
            try {
              options.onError(error);
            } catch {
              // Error reporting must not turn teardown failure into a rejection.
            }
          }
          if (vad === currentVad) vad = undefined;
        }
        speechActive = false;
        speechStarting = false;
        speechEnding = false;
        endRequested = false;
        startedTurnGeneration = undefined;
        state = {
          mode: "manual_fallback",
          error: state.error ?? new Error("VAD controller destroyed"),
        };
      });
      return destroyPromise;
    },
  };
}

/** Whether an automatic-turn rejection occurred after its boundary was sent. */
function isFinalizedAutomaticTurnError(
  error: unknown,
): error is { readonly turnFinalized: true } {
  return (
    typeof error === "object" &&
    error !== null &&
    "turnFinalized" in error &&
    error.turnFinalized === true
  );
}

const DEFAULT_PRE_ROLL_MS = 250;
const MAX_PRE_ROLL_MS = 500;

/** Normalizes operator tuning to the transport's safe millisecond range. */
function normalizePreRollMs(configured: number | undefined): number {
  if (configured === undefined) return DEFAULT_PRE_ROLL_MS;
  if (!Number.isFinite(configured)) return DEFAULT_PRE_ROLL_MS;
  return Math.max(0, Math.min(MAX_PRE_ROLL_MS, Math.round(configured)));
}

/** Normalizes and validates the operator-controlled VAD asset directory. */
function normalizeAssetBaseUrl(configured: string | undefined): string {
  const value = configured?.trim() || "/";
  if (value.startsWith("//"))
    throw new Error("VAD asset URLs must not be protocol-relative");

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (!hasScheme) {
    if (value.includes("?") || value.includes("#"))
      throw new Error(
        "VAD asset directory URLs must not include query or fragment",
      );
    return withOneTrailingSlash(value);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VAD asset URL is malformed");
  }
  if (url.protocol !== "https:")
    throw new Error("Absolute VAD asset URLs must use HTTPS");
  if (url.username || url.password)
    throw new Error("VAD asset URLs must not include credentials");
  if (url.search || url.hash)
    throw new Error(
      "VAD asset directory URLs must not include query or fragment",
    );
  url.pathname = withOneTrailingSlash(url.pathname);
  return url.href;
}

/** Replaces any trailing slash run with exactly one slash. */
function withOneTrailingSlash(value: string): string {
  return `${value.replace(/\/+$/, "")}/`;
}
