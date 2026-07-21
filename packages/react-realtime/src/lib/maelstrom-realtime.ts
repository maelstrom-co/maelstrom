import type {
  Orchestrator,
  TranscriptEntry,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  RealtimeInstance,
  RealtimeProviderAdapter,
  SummarizeFn,
} from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import type { RealTimeVADOptions } from '@ricky0123/vad-web';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import {
  type BrowserVadController,
  createBrowserVadController,
} from './browser-vad-controller.js';
import { createVoiceOrb, type VoiceOrbProps } from './voice-orb.js';

/** Context passed to {@link MaelstromRealtimeOptions.createAdapter}. */
export interface CreateAdapterContext {
  /**
   * The session this adapter is being built for. Providers that scope
   * server-side resources per session (an ephemeral token mint, a room name)
   * need this to correlate the adapter with the rest of the app's session
   * state.
   */
  readonly sessionId: SessionId;
}

/** Options for {@link maelstromRealtime}. */
export interface MaelstromRealtimeOptions {
  /**
   * Builds the provider transport (OpenAI, Google, …) for a new session.
   * Called once per session creation — not once per render, and not once per
   * `useVoice()` call — so it is safe to do provider setup (token minting
   * closures, etc.) inside it. Receives the orchestrator's `sessionId` so the
   * adapter can scope per-session server resources (an ephemeral token mint
   * keyed to the session, a room name derived from it, …) to this session.
   */
  readonly createAdapter: (
    ctx: CreateAdapterContext,
  ) => RealtimeProviderAdapter;
  /**
   * Overrides the default snapshot-to-sentence summarizer used for grounding
   * pushes and as the `update_ui` tool-result fallback. It is only a fallback
   * for `update_ui`: the engine's conversational `userMessage` is spoken
   * verbatim when present, so this runs for that path solely when the engine
   * surfaced no reply.
   */
  readonly summarize?: SummarizeFn;
  /** Debounce window for latest-wins grounding pushes. Forwarded to `RealtimeSession`. */
  readonly groundingDebounceMs?: number;
  /** Observes sidechannel events (tool calls, timings, transcripts) for telemetry. */
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enables verbose debug tracing on the underlying `RealtimeSession`. */
  readonly debug?: boolean;
}

type BrowserVadReservedOption =
  | 'audioContext'
  | 'getStream'
  | 'pauseStream'
  | 'resumeStream'
  | 'onSpeechStart'
  | 'onSpeechEnd'
  | 'onVADMisfire'
  | 'onSpeechRealStart'
  | 'onFrameProcessed'
  | 'startOnLoad'
  | 'submitUserSpeechOnPause'
  | 'baseAssetPath'
  | 'onnxWASMBasePath'
  | 'ortConfig';

/**
 * Non-lifecycle VAD tuning forwarded to `@ricky0123/vad-web`.
 *
 * Maelstrom owns the stream, asset, lifecycle, speech callback, and ONNX
 * runtime configuration fields. The reserved callback names are
 * `onSpeechStart`, `onSpeechEnd`, `onVADMisfire`, `onSpeechRealStart`, and
 * `onFrameProcessed`; casts cannot override those fields at runtime.
 */
export type BrowserVadProviderOptions = Omit<
  Partial<RealTimeVADOptions>,
  BrowserVadReservedOption
>;

/** Opt-in browser VAD configuration using self-hosted assets. */
export interface BrowserVadConfig {
  /**
   * Same-origin base URL containing the matching VAD worklet, Silero model
   * files, and ONNX Runtime `.mjs`/`.wasm` files. Relative paths are supported.
   * Consumers must publish the asset set generated for the exact
   * `@ricky0123/vad-web` and `onnxruntime-web` versions they install.
   */
  readonly assetBaseUrl: string;
  /** Provider tuning; Maelstrom-owned lifecycle, asset, and runtime controls are excluded. */
  readonly providerOptions?: BrowserVadProviderOptions;
  /**
   * Receives VAD initialization, lifecycle, and turn-callback failures that
   * switch automatic turns to manual fallback. Errors thrown by this callback
   * are contained and do not reject the VAD operation; the existing
   * `turnControl.startTurn()` and `turnControl.endTurn()` controls remain
   * available for manual turns.
   */
  readonly onError?: (error: unknown) => void;
}

/** Return value of the `useVoice()` hook added by {@link maelstromRealtime}. */
export interface UseVoiceResult {
  /** Lifecycle state of the shared session, live-updated across every `useVoice()` consumer. */
  readonly state: VoiceSessionState;
  /** Populated when state is 'error'; RealtimeVoiceError for typed causes. */
  readonly error: unknown;
  /** Latest user utterance (accumulated fragments until final). */
  readonly userTranscript: TranscriptEntry | undefined;
  /** Latest assistant utterance (accumulated fragments until final). */
  readonly assistantTranscript: TranscriptEntry | undefined;
  /**
   * Advanced access to the realtime session, including audio streams and
   * sidechannel events.
   */
  readonly session: RealtimeSession;
  /**
   * Turn-boundary control, present only when the underlying adapter is a
   * push-to-talk cascade (STT→LLM→TTS without server-side VAD) that needs the
   * user to delimit each turn; speech-native adapters leave it `undefined`.
   *
   * `RealtimeSession` never calls it — it is surfaced straight from the
   * adapter to this UI layer. Consumers use `turnMode` to choose between
   * automatic VAD and hold-to-talk controls; `turnControl !== undefined`
   * remains the capability check for the fallback controls.
   */
  readonly turnControl?: AdapterTurnControl;
  /**
   * `automatic` while browser VAD is active; `manual` means consumers delimit
   * turns through `turnControl` because VAD is absent, unavailable, or failed.
   */
  readonly turnMode: 'automatic' | 'manual';
  /** Browser VAD failure that caused manual fallback, if any. */
  readonly vadError: unknown;
  /** Connects the shared session. Safe to call from any consumer under the same Provider. */
  readonly connect: () => Promise<void>;
  /** Disconnects the shared session immediately, regardless of other active consumers. */
  readonly disconnect: () => Promise<void>;
}

function createBridge(orchestrator: Orchestrator): RealtimeInstance {
  return {
    // Pass the engine's conversational reply through the seam so the session
    // can speak it verbatim instead of a structural summary.
    submitIntent: (intent) =>
      orchestrator
        .processIntent(intent)
        .then((response) => ({ userMessage: response.userMessage })),
    waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (cb) => orchestrator.onSettled(cb),
  };
}

/**
 * Adds realtime voice to a Maelstrom instance: `m.useVoice()` drives a
 * shared, provider-agnostic voice session whose `update_ui` tool calls flow
 * through the same intent path as keyboard input.
 *
 * @example
 * const m = createMaelstrom({ vessels }).with(
 *   maelstromRealtime({
 *     createAdapter: ({ sessionId }) => new OpenAIAdapter({ mintToken: () => mintOpenAIToken(sessionId) }),
 *   }),
 * );
 */
export interface MaelstromRealtimeBuilder
  extends MaelstromExtension<{
    useVoice: () => UseVoiceResult;
    VoiceOrb: (props: VoiceOrbProps) => ReactElement;
  }> {
  /**
   * Returns a cascade extension with browser VAD and manual fallback. This is
   * intended for adapters that expose both `turnControl` and a shared mic
   * stream, such as LiveKit; it does not change the OpenAI realtime extension.
   */
  withVAD(config: BrowserVadConfig): MaelstromExtension<{
    useVoice: () => UseVoiceResult;
    VoiceOrb: (props: VoiceOrbProps) => ReactElement;
  }>;
}

export function maelstromRealtime(
  options: MaelstromRealtimeOptions,
): MaelstromRealtimeBuilder {
  const extension = createRealtimeExtension(options);
  return Object.assign(extension, {
    withVAD: (config: BrowserVadConfig) =>
      createRealtimeExtension({ ...options, vad: config }),
  });
}

function createRealtimeExtension(
  options: MaelstromRealtimeOptions & { readonly vad?: BrowserVadConfig },
): MaelstromExtension<{
  useVoice: () => UseVoiceResult;
  VoiceOrb: (props: VoiceOrbProps) => ReactElement;
}> {
  // Keep one session per orchestrator and capture the adapter's turn capability
  // because RealtimeSession does not expose its adapter.
  const sessions = new WeakMap<Orchestrator, VoiceSessionEntry>();

  function getOrCreateSession(orchestrator: Orchestrator): VoiceSessionEntry {
    const existing = sessions.get(orchestrator);
    if (existing) {
      if (options.vad && existing.turnControl) attachVad(existing);
      return existing;
    }
    const sessionId = orchestrator.getConfig().sessionId;
    const adapter = options.createAdapter({ sessionId });
    const session = new RealtimeSession({
      adapter,
      instance: createBridge(orchestrator),
      sessionId,
      summarize: options.summarize,
      groundingDebounceMs: options.groundingDebounceMs,
      onEvent: options.onEvent,
      debug: options.debug,
    });
    const entry: VoiceSessionEntry = {
      orchestrator,
      sessions,
      session,
      turnControl: adapter.turnControl,
      consumerCount: 0,
      desiredConnection: false,
      phase: 'live',
      generation: 0,
      reconciliation: Promise.resolve(),
      reconciliationQueued: false,
      cleanupStarted: false,
      cleanupPromise: undefined,
      vad: undefined,
      vadError: undefined,
      vadStateUnsubscribe: undefined,
      vadHandlers: new Set(),
      reportVadError: (error) => {
        entry.vadError = error;
        notifyVad(entry);
        try {
          options.vad?.onError?.(error);
        } catch {
          // Error reporting must not turn teardown failure into a rejection.
        }
      },
    };
    if (options.vad && adapter.turnControl) attachVad(entry);
    sessions.set(orchestrator, entry);
    return entry;
  }

  function attachVad(entry: VoiceSessionEntry): void {
    if (!entry.turnControl || entry.phase !== 'live') return;
    if (!entry.vad) {
      entry.vad = createBrowserVadController({
        session: entry.session,
        turnControl: entry.turnControl,
        assetBaseUrl: options.vad?.assetBaseUrl ?? '/vad-web/',
        providerOptions: options.vad?.providerOptions,
        onError: entry.reportVadError,
      });
    }
    if (entry.vadStateUnsubscribe) return;
    entry.vadStateUnsubscribe = entry.session.on('state', (state) => {
      if (state === 'connected') void maybeStartVad(entry);
      if (state === 'idle') void pauseVad(entry);
      notifyVad(entry);
    });
  }

  async function maybeStartVad(entry: VoiceSessionEntry): Promise<void> {
    await enqueueReconciliation(entry, (generation) => {
      if (
        !isLive(entry, generation) ||
        !entry.desiredConnection ||
        entry.session.state !== 'connected' ||
        !entry.session.getAudioStreams().mic ||
        !entry.vad ||
        entry.vad.state.mode === 'active'
      )
        return;
      const controller = entry.vad;
      return controller.start().then(() => {
        if (
          isLive(entry, generation) &&
          entry.desiredConnection &&
          entry.vad === controller
        )
          notifyVad(entry);
      });
    });
  }

  async function pauseVad(entry: VoiceSessionEntry): Promise<void> {
    await enqueueReconciliation(entry, (generation) => {
      if (!isLive(entry, generation) || !entry.vad) return;
      const controller = entry.vad;
      return controller.pause().then(() => {
        if (isLive(entry, generation) && entry.vad === controller)
          notifyVad(entry);
      });
    });
  }

  function maybeStartVadIfConnected(entry: VoiceSessionEntry): void {
    if (entry.session.state === 'connected') void maybeStartVad(entry);
  }

  return (ctx: MaelstromExtensionContext) => {
    const useVoice = (): UseVoiceResult => {
      const { orchestrator } = ctx.useMaelstromContext();
      const entry = getOrCreateSession(orchestrator);
      const { session, turnControl } = entry;

      // Seeded from the session's current state rather than a hardcoded
      // 'idle' — a subscriber mounting after another one already connected
      // the shared session must not render a stale status.
      const [state, setState] = useState<VoiceSessionState>(session.state);
      const [error, setError] = useState<unknown>(session.lastError);
      const [userTranscript, setUserTranscript] = useState<
        TranscriptEntry | undefined
      >(undefined);
      const [assistantTranscript, setAssistantTranscript] = useState<
        TranscriptEntry | undefined
      >(undefined);
      const [vadPolicy, setVadPolicy] = useState(() => getVadPolicy(entry));

      useEffect(() => {
        const unsubscribe = session.on('state', (next) => {
          setState(next);
          setError(session.lastError);
        });
        // The session may have already advanced past the state captured by
        // the useState initializer in the gap between render and this
        // effect running; re-read here so state can't stay stale.
        setState(session.state);
        setError(session.lastError);
        return unsubscribe;
      }, [session]);

      useEffect(() => {
        const handler = () => setVadPolicy(getVadPolicy(entry));
        entry.vadHandlers.add(handler);
        setVadPolicy(getVadPolicy(entry));
        return () => {
          entry.vadHandlers.delete(handler);
        };
      }, [entry]);

      useEffect(() => {
        return session.on('transcript', (entry) => {
          const setTranscript =
            entry.role === 'user' ? setUserTranscript : setAssistantTranscript;
          setTranscript((prev) => {
            // A final entry replaces the accumulation with its own full text;
            // a non-final entry appends onto the building string, starting a
            // fresh accumulation if the previous entry for this role was
            // already final (or there wasn't one yet).
            if (entry.final) return entry;
            const base = prev && !prev.final ? prev.text : '';
            return { role: entry.role, text: base + entry.text, final: false };
          });
        });
      }, [session]);

      // The retirement request is deferred one microtask so a StrictMode
      // fake-unmount/remount reuses the same live entry.
      useEffect(() => {
        entry.consumerCount += 1;
        entry.desiredConnection = true;
        requestReconciliation(orchestrator, entry, sessions);
        if (entry.consumerCount === 1) maybeStartVadIfConnected(entry);
        return () => {
          entry.consumerCount = Math.max(0, entry.consumerCount - 1);
          entry.desiredConnection = entry.consumerCount > 0;
          requestReconciliation(orchestrator, entry, sessions);
        };
      }, [orchestrator, entry]);

      const connect = useCallback(async () => {
        const generation = entry.generation;
        await session.connect();
        if (isLive(entry, generation) && entry.desiredConnection)
          await maybeStartVad(entry);
      }, [entry, session]);
      const disconnect = useCallback(() => session.disconnect(), [session]);

      return {
        state,
        error,
        userTranscript,
        assistantTranscript,
        session,
        turnControl,
        turnMode: vadPolicy.mode,
        vadError: vadPolicy.error,
        connect,
        disconnect,
      };
    };

    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
  };
}

function getVadPolicy(entry: VoiceSessionEntry): {
  mode: 'automatic' | 'manual';
  error: unknown;
} {
  const state = entry.vad?.state;
  return {
    mode:
      entry.turnControl && state?.mode === 'active' ? 'automatic' : 'manual',
    error: entry.vadError ?? state?.error,
  };
}

function notifyVad(entry: VoiceSessionEntry): void {
  for (const handler of entry.vadHandlers) handler();
}

/**
 * Shared-session record kept per orchestrator: the `RealtimeSession` plus the
 * `turnControl` snapshotted off its adapter at creation, since the session
 * itself doesn't re-expose the adapter.
 */
interface VoiceSessionEntry {
  readonly orchestrator: Orchestrator;
  readonly sessions: WeakMap<Orchestrator, VoiceSessionEntry>;
  readonly session: RealtimeSession;
  readonly turnControl: AdapterTurnControl | undefined;
  consumerCount: number;
  desiredConnection: boolean;
  phase: 'live' | 'retiring' | 'retired';
  generation: number;
  reconciliation: Promise<void>;
  reconciliationQueued: boolean;
  cleanupStarted: boolean;
  cleanupPromise: Promise<void> | undefined;
  vad: BrowserVadController | undefined;
  vadError: unknown;
  vadStateUnsubscribe: (() => void) | undefined;
  readonly vadHandlers: Set<() => void>;
  readonly reportVadError: (error: unknown) => void;
}

const TEARDOWN_TIMEOUT_MS = 25;

function cleanupWithin(
  operation: () => Promise<void>,
  report: (error: unknown) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      report(new Error('Voice session cleanup timed out'));
      resolve(false);
    }, TEARDOWN_TIMEOUT_MS);

    Promise.resolve()
      .then(operation)
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          report(error);
          resolve(false);
        },
      );
  });
}

type Reconciliation = (generation: number) => Promise<void> | void;

function isLive(entry: VoiceSessionEntry, generation: number): boolean {
  return (
    entry.phase === 'live' &&
    entry.generation === generation &&
    entry.sessions.get(entry.orchestrator) === entry
  );
}

function enqueueReconciliation(
  entry: VoiceSessionEntry,
  operation: Reconciliation,
): Promise<void> {
  const generation = entry.generation;
  entry.reconciliation = entry.reconciliation
    .then(() => {
      if (!isLive(entry, generation)) return;
      return operation(generation);
    })
    .catch((error) => {
      entry.reportVadError(error);
    });
  return entry.reconciliation;
}

function requestReconciliation(
  orchestrator: Orchestrator,
  entry: VoiceSessionEntry,
  sessions: WeakMap<Orchestrator, VoiceSessionEntry>,
): void {
  if (entry.reconciliationQueued) return;
  entry.reconciliationQueued = true;
  queueMicrotask(() => {
    entry.reconciliationQueued = false;
    if (entry.phase !== 'live' || entry.consumerCount > 0) return;
    retireEntry(orchestrator, entry, sessions);
  });
}

function retireEntry(
  orchestrator: Orchestrator,
  entry: VoiceSessionEntry,
  sessions: WeakMap<Orchestrator, VoiceSessionEntry>,
): void {
  if (entry.phase !== 'live' || entry.consumerCount > 0) return;
  entry.phase = 'retiring';
  entry.generation += 1;
  if (sessions.get(orchestrator) === entry) sessions.delete(orchestrator);

  const controller = entry.vad;
  entry.vad = undefined;
  const unsubscribe = entry.vadStateUnsubscribe;
  entry.vadStateUnsubscribe = undefined;
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch (error) {
      entry.reportVadError(error);
    }
  }

  if (entry.cleanupStarted) return;
  entry.cleanupStarted = true;
  const report = (error: unknown) => entry.reportVadError(error);
  entry.cleanupPromise = (async () => {
    await Promise.all([
      cleanupWithin(() => controller?.pause() ?? Promise.resolve(), report),
      cleanupWithin(() => entry.session.disconnect(), report),
    ]);
    await cleanupWithin(
      () => controller?.destroy() ?? Promise.resolve(),
      report,
    );
    entry.phase = 'retired';
  })();
}
