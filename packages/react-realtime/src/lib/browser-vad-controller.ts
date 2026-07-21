import type {
  AdapterAudioStreams,
  AdapterTurnControl,
} from '@maelstrom-co/realtime';
import type { RealTimeVADOptions } from '@ricky0123/vad-web';

import type { BrowserVadProviderOptions } from './maelstrom-realtime.js';

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
  readonly turnControl: AdapterTurnControl;
  readonly onError: (error: unknown) => void;
  readonly assetBaseUrl?: string;
  readonly providerOptions?: BrowserVadProviderOptions;
  readonly loadMicVAD?: () => Promise<MicVADFactory>;
};

/** Browser VAD lifecycle; manual fallback keeps push-to-talk available. */
export type BrowserVadControllerState =
  | { readonly mode: 'idle'; readonly error?: undefined }
  | { readonly mode: 'active'; readonly error?: undefined }
  | { readonly mode: 'manual_fallback'; readonly error: unknown };

/** Controls for the browser-owned VAD instance. */
export type BrowserVadController = {
  readonly state: BrowserVadControllerState;
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

async function loadMicVAD(): Promise<MicVADFactory> {
  const module = await import('@ricky0123/vad-web');
  return module.MicVAD;
}

/**
 * Creates a VAD controller that reuses the adapter's mic stream.
 *
 * The controller owns VAD lifecycle only; Maelstrom does not intentionally stop
 * the adapter's shared media tracks during VAD teardown.
 * Initialization and callback failures are reported through `onError` and
 * transition to `manual_fallback` instead of escaping into the React layer.
 */
export function createBrowserVadController(
  options: BrowserVadControllerOptions,
): BrowserVadController {
  let state: BrowserVadControllerState = { mode: 'idle' };
  let vad: MicVAD | undefined;
  let destroyed = false;
  let speechActive = false;
  let speechStarting = false;
  let speechEnding = false;
  let endRequested = false;
  let callbacksEnabled = true;
  let queue = Promise.resolve();
  let fallbackPause: Promise<void> | undefined;
  let destroyRequested = false;
  let lifecycleSequence = 0;
  let destroySequence = Number.POSITIVE_INFINITY;
  let destroyPromise: Promise<void> | undefined;

  const setFallback = (error: unknown) => {
    if (!callbacksEnabled && state.mode === 'manual_fallback')
      return fallbackPause;
    callbacksEnabled = false;
    state = { mode: 'manual_fallback', error };
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

  const startSpeech = () => {
    if (
      !callbacksEnabled ||
      state.mode !== 'active' ||
      speechActive ||
      speechStarting ||
      destroyed
    )
      return Promise.resolve();
    speechStarting = true;
    let startPromise: Promise<void>;
    try {
      startPromise = options.turnControl.startTurn();
    } catch (error) {
      speechStarting = false;
      return setFallback(error);
    }
    return enqueue(async () => {
      await startPromise;
      if (!destroyed) speechActive = true;
    }).then(
      () => {
        speechStarting = false;
      },
      (error) => {
        speechStarting = false;
        return setFallback(error);
      },
    );
  };

  const endSpeech = () => {
    if (
      !callbacksEnabled ||
      state.mode !== 'active' ||
      endRequested ||
      speechEnding ||
      (!speechActive && !speechStarting)
    ) {
      return Promise.resolve();
    }
    endRequested = true;
    return enqueue(async () => {
      endRequested = false;
      if (!speechActive || destroyed) return;
      speechEnding = true;
      try {
        await options.turnControl.endTurn();
        speechActive = false;
      } finally {
        speechEnding = false;
      }
    }).catch((error) => {
      endRequested = false;
      speechEnding = false;
      return setFallback(error);
    });
  };

  const initialize = async () => {
    try {
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
              'A shared microphone stream is required for browser VAD',
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
      if (callbacksEnabled) state = { mode: 'active' };
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
        state.mode === 'active' ||
        state.mode === 'manual_fallback'
      )
        return;
      if (vad) {
        try {
          await vad.start();
          if (!destroyed && callbacksEnabled) state = { mode: 'active' };
        } catch (error) {
          if (!destroyed) setFallback(error);
        }
        return;
      }
      await initialize();
    });
  };

  const pause = () =>
    enqueue(async () => {
      const currentVad = vad;
      if (!currentVad || destroyed) return;
      try {
        await currentVad.pause();
        if (!destroyed && state.mode !== 'manual_fallback')
          state = { mode: 'idle' };
      } catch (error) {
        setFallback(error);
      }
    });

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
        state = {
          mode: 'manual_fallback',
          error: state.error ?? new Error('VAD controller destroyed'),
        };
      });
      return destroyPromise;
    },
  };
}

function normalizeAssetBaseUrl(configured: string | undefined): string {
  const value = configured?.trim() || '/';
  const isAbsolute =
    /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//');
  if (!isAbsolute) return value.endsWith('/') ? value : `${value}/`;

  const location =
    typeof globalThis.location === 'undefined'
      ? undefined
      : globalThis.location;
  if (!location)
    throw new Error(
      'VAD asset URLs must be same-origin and require a browser location',
    );
  const url = new URL(value, location.href);
  if (url.origin !== location.origin)
    throw new Error('VAD assets must be served from the same-origin');
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}
