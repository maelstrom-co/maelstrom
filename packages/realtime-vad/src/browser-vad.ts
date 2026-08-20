import type { RealTimeVADOptions } from '@ricky0123/vad-web';
import type { ResolvedBrowserVadConfig } from './browser-vad-config.js';

type EnabledBrowserVadConfig = Extract<
  ResolvedBrowserVadConfig,
  { readonly enabled: true }
>;

type MicVAD = {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

type MicVADFactory = {
  readonly new: (options?: Partial<RealTimeVADOptions>) => Promise<MicVAD>;
};

/**
 * The parameter type of {@link createBrowserVad}.
 *
 * The three turn callbacks are the whole integration surface: this package
 * detects speech edges and never touches the transport, so resuming
 * publication, flushing pre-roll, and discarding a misfire are all the
 * caller's work. `cancelTurn` is required, not optional — every sub-threshold
 * utterance invokes it, and a missing implementation retires the VAD and drops
 * the session to manual turns permanently.
 */
export type CreateBrowserVadOptions = {
  /** Connection-bound local clone; MicVAD may observe but never stop it. */
  readonly stream: MediaStream;
  /** Already validated automatic-mode configuration. */
  readonly config: Omit<EnabledBrowserVadConfig, 'enabled'>;
  /** Starts the matching adapter generation with configured transport pre-roll. */
  readonly startTurn: () => Promise<void>;
  /** Drains and closes the matching adapter generation's active turn. */
  readonly endTurn: () => Promise<void>;
  /** Cancels a misfire without the provider commit performed by `endTurn`. */
  readonly cancelTurn: () => Promise<void>;
  /** Converts an automatic callback failure into safe manual degradation. */
  readonly onFailure: (
    error: unknown,
    context: {
      /** Whether transport turn closure still belongs to the adapter. */
      readonly turnActive: boolean;
      /** Idempotently pauses and destroys this VAD generation. */
      readonly retire: () => Promise<void>;
    },
  ) => Promise<void>;
  /** Test seam; production dynamically imports MicVAD. */
  readonly loadMicVAD?: () => Promise<MicVADFactory>;
};

export type BrowserVad = {
  /** Fences callbacks, closes an active turn, and destroys VAD without stopping the shared stream. */
  destroy(): Promise<void>;
};

async function loadMicVAD(): Promise<MicVADFactory> {
  const module = await import('@ricky0123/vad-web');
  return module.MicVAD as unknown as MicVADFactory;
}

/**
 * Starts one connection-bound browser VAD over the adapter's local microphone
 * stream. Maelstrom owns every stream and lifecycle callback passed to MicVAD.
 * A real speech end commits the active transport turn; a VAD misfire instead
 * cancels it because vad-web emits no following `onSpeechEnd` for speech shorter
 * than `minSpeechMs`. Adjacent duplicate boundaries collapse while alternating
 * rapid boundaries retain their order even though provider callbacks are not
 * assumed to be serialized. Load, construction, and initial start failures
 * reject so connect can choose manual mode. Later boundary failures fence
 * callbacks and offer `onFailure` the diagnostic once. When a turn is active,
 * the handler also receives that state and an idempotent retire operation so it
 * can safely close or cancel transport, retire VAD, then expose manual control in
 * that order. Without an active turn, VAD retires before the handler runs.
 * Handler rejection is swallowed only after retirement is guaranteed. Destroy
 * is idempotent, closes an established turn when no boundary or failure handler
 * owns finalization, and does not stop the shared microphone stream. Every
 * callback becomes a no-op after destroy/failure, including stale callbacks from
 * a superseded connection generation.
 */
export async function createBrowserVad(
  options: CreateBrowserVadOptions,
): Promise<BrowserVad> {
  let vad: MicVAD | undefined;
  let destroyed = false;
  let failed = false;
  let turnActive = false;
  let boundaryInProgress = false;
  let retirePromise: Promise<void> | undefined;
  let queue = Promise.resolve();
  let lastBoundary:
    | {
        readonly kind: 'start' | 'end' | 'cancel';
        readonly result: Promise<void>;
      }
    | undefined;

  /** Pauses and destroys the provider runtime at most once. */
  const retire = (): Promise<void> => {
    retirePromise ??= (async () => {
      await vad?.pause().catch(() => {});
      await vad?.destroy().catch(() => {});
      vad = undefined;
    })();
    return retirePromise;
  };

  /** Fences callbacks and transfers any active turn before clearing its state. */
  const fail = async (error: unknown): Promise<void> => {
    if (destroyed || failed) return;
    failed = true;
    if (!turnActive) await retire();
    await options.onFailure(error, { turnActive, retire }).catch(() => {});
    await retire();
    turnActive = false;
  };

  const queueBoundary = (kind: 'start' | 'end' | 'cancel'): Promise<void> => {
    if (destroyed || failed) return Promise.resolve();
    if (lastBoundary?.kind === kind) return lastBoundary.result;

    const result = queue
      .then(async () => {
        if (destroyed || failed) return;
        boundaryInProgress = true;
        try {
          if (kind === 'start') {
            if (turnActive) return;
            await options.startTurn();
            if (!destroyed && !failed) turnActive = true;
            return;
          }
          if (!turnActive) return;
          try {
            if (kind === 'cancel') await options.cancelTurn();
            else await options.endTurn();
            turnActive = false;
          } catch (error) {
            if (isFinalizedTurnError(error)) turnActive = false;
            throw error;
          }
        } finally {
          boundaryInProgress = false;
        }
      })
      .catch(fail);
    queue = result.catch(() => {});
    const boundary = { kind, result } as const;
    lastBoundary = boundary;
    void result.finally(() => {
      if (lastBoundary === boundary) lastBoundary = undefined;
    });
    return result;
  };

  const factory = await (options.loadMicVAD?.() ?? loadMicVAD());
  try {
    const createdVad = await factory.new({
      ...options.config.providerOptions,
      audioContext: undefined,
      baseAssetPath: options.config.assetBaseUrl,
      onnxWASMBasePath: options.config.assetBaseUrl,
      startOnLoad: false,
      getStream: async () => options.stream,
      pauseStream: async () => {},
      resumeStream: async (stream: MediaStream) => stream,
      submitUserSpeechOnPause: false,
      onSpeechStart: () => queueBoundary('start'),
      onSpeechEnd: () => queueBoundary('end'),
      onVADMisfire: () => queueBoundary('cancel'),
      onSpeechRealStart: () => {},
      onFrameProcessed: () => {},
    });
    vad = createdVad;
    await createdVad.start();
  } catch (error) {
    await vad?.destroy().catch(() => {});
    throw error;
  }

  return {
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!failed && !boundaryInProgress) await queue;
      if (turnActive && !failed && !boundaryInProgress) {
        await options.endTurn().catch(() => {});
        turnActive = false;
      }
      await retire();
    },
  };
}

function isFinalizedTurnError(
  error: unknown,
): error is { readonly turnFinalized: true } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'turnFinalized' in error &&
    error.turnFinalized === true
  );
}
