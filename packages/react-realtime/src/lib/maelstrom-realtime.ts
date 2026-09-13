import type {
  Orchestrator,
  TranscriptEntry,
  VoiceObservationSnapshot,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  ContinuousTranscriptOptions,
  GreetingState,
  RealtimeInstance,
  RealtimeProviderAdapter,
  SummarizeFn,
} from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  type SharedRealtimeSessionEntry,
  SharedRealtimeSessionRegistry,
} from './shared-realtime-session.js';
import { createVoiceOrb, type VoiceOrbProps } from './voice-orb.js';

/** Context passed to {@link MaelstromRealtimeOptions.createAdapter}. */
export interface CreateAdapterContext {
  /** Session identifier used to scope provider-side resources. */
  readonly sessionId: SessionId;
}

/** Options for {@link maelstromRealtime}. */
export interface MaelstromRealtimeOptions {
  /** Conversation-only instructions for providers with a separate managed tool backend. */
  readonly conversationInstructions?: string;
  /** Bounds and grouping policy for the opt-in continuous transcript channel. */
  readonly transcript?: ContinuousTranscriptOptions;
  /**
   * Builds one provider adapter for each shared session. The factory receives
   * the orchestrator session identifier and is not called per render or hook.
   */
  readonly createAdapter: (
    context: CreateAdapterContext,
  ) => RealtimeProviderAdapter;
  /** Overrides the deterministic structural-summary fallback. */
  readonly summarize?: SummarizeFn;
  /** Debounce window for latest-wins grounding pushes. */
  readonly groundingDebounceMs?: number;
  /** Observes provider-neutral sidechannel events. Turn-mode diagnostics are excluded. */
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enables verbose tracing in the underlying session. */
  readonly debug?: boolean;
  /**
   * Optional fixed assistant greeting for each voice session.
   *
   * When set, `text` is spoken verbatim once per voice session. The shared
   * {@link GreetingCoordinator} acknowledges the line in Engine history before
   * speech starts, so reconnects and remounts do not double-speak a greeting
   * the engine already retained.
   */
  readonly greeting?: { readonly text: string };
}

/** Continuous observations and controls using the same provider lifetime as useVoice. */
export interface UseVoiceObservationsResult {
  /** Shared retained snapshot; timed fragments are never accumulated as legacy turns. */
  readonly snapshot: VoiceObservationSnapshot;
  /** Shared session for lifecycle controls and generated-opening requests. */
  readonly session: RealtimeSession;
}

/**
 * Return value of the `useVoice()` hook added by {@link maelstromRealtime}.
 *
 * The hook reports what the session is doing; it does not promise a fixed
 * sequence of events. There is no universal state progression across providers
 * and no universal retry policy, because each adapter owns its own connection
 * and turn behavior. Render the current `state` rather than inferring success
 * from an expected order, and use the typed error together with your own
 * deployment policy to decide whether to request microphone permission, repair
 * token minting, inspect the connection, or offer a reconnect.
 */
export interface UseVoiceResult {
  /** Lifecycle state of the shared session, updated for every consumer. */
  readonly state: VoiceSessionState;
  /**
   * Retained fixed-greeting presentation lifecycle from the shared
   * {@link RealtimeSession}, initialized synchronously from coordinator proof
   * and updated for every `useVoice()` consumer. It is not a hook-local timer,
   * caption, error, `VoiceSessionState`, or turn-mode derivation.
   *
   * `pending` is retryable; `preparing` starts before the provider handshake and
   * can wait indefinitely for Engine readiness; `settled` ends presentation
   * without implying provider activity or speech success; `skipped` is the
   * terminal explicit user choice; and `not_configured` means that no greeting
   * exists. Retained terminal proof survives shared session recreation, and
   * stale connection generations cannot update it.
   */
  readonly greetingState: GreetingState;
  /** Failure behind the current `error` state, if any. */
  readonly error: unknown;
  /** Latest accumulated or final user transcript. */
  readonly userTranscript: TranscriptEntry | undefined;
  /** Latest accumulated or final assistant transcript. */
  readonly assistantTranscript: TranscriptEntry | undefined;
  /** Advanced access to the shared realtime session and its audio streams. */
  readonly session: RealtimeSession;
  /**
   * Adapter-owned manual controls, available only after the session establishes
   * manual mode. Automatic mode and lifecycle teardown never expose controls,
   * even while the last manual mode and its diagnostic remain retained.
   */
  readonly turnControl?: AdapterTurnControl;
  /** Current provider-neutral turn-boundary mode retained by the session. */
  readonly turnMode: 'automatic' | 'manual';
  /**
   * Diagnostic from automatic-mode degradation. Clean automatic or intentional
   * manual transitions clear it. It must not be rendered verbatim or serialized.
   */
  readonly turnModeError: unknown;
  /**
   * Connects the shared session; concurrent lifecycle safety is session-owned.
   *
   * Resolving means the provider session is ready. Rejecting means the attempt
   * failed; the session usually moves to `error` with the cause in `lastError`,
   * but an attempt invalidated by a concurrent `disconnect()` rejects while the
   * session stays `idle`, so read `state` rather than inferring it from the
   * rejection. Calling this while a connection is already starting or live may
   * be a no-op.
   */
  readonly connect: () => Promise<void>;
  /**
   * Disconnects the shared session regardless of other mounted consumers.
   *
   * Calling this while no session is live may be a no-op. A rejection is not
   * swallowed, so cleanup failures stay visible and can be retried.
   */
  readonly disconnect: () => Promise<void>;
  /**
   * Synchronously skip the shared configured greeting. This is idempotent,
   * shared by every hook consumer, and never disconnects voice.
   */
  readonly skipGreeting: () => void;
}

function createBridge(orchestrator: Orchestrator): RealtimeInstance {
  return {
    applicationWork: {
      getSnapshot: () => ({
        planning: orchestrator.requestCoordinator.isProcessing
          ? 'active'
          : 'inactive',
        applying:
          orchestrator.commandProcessor.store.state.status === 'error'
            ? 'unknown'
            : orchestrator.commandProcessor.store.state.status ===
                  'processing' || orchestrator.commandProcessor.queueLength > 0
              ? 'active'
              : 'inactive',
      }),
      subscribe: (handler) => {
        const request =
          orchestrator.requestCoordinator.store.subscribe(handler);
        const commands = orchestrator.commandProcessor.store.subscribe(handler);
        return () => {
          request.unsubscribe();
          commands.unsubscribe();
        };
      },
    },
    submitIntent: (intent) =>
      orchestrator
        .processIntent(intent)
        .then((response) => ({ userMessage: response.userMessage })),
    waitForIdle: async () => {
      await orchestrator.commandProcessor.waitForIdle();
    },
    waitForIdleResult: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (callback) => orchestrator.onSettled(callback),
    addAssistantMessageAcknowledged: (args) =>
      orchestrator.addAssistantMessageAcknowledged(args),
    observeEngineConnection: (cb) => {
      const unsubscribe = orchestrator.connectionManager.events.on(
        'connection_status_changed',
        (event) => cb(event.status === 'connected'),
      );
      cb(
        orchestrator.connectionManager.store.state.connectionStatus ===
          'connected',
      );
      return unsubscribe;
    },
  };
}

type RealtimeExtension = MaelstromExtension<{
  useVoice: () => UseVoiceResult;
  /** Reads continuous observations and retains the shared session without connecting the provider. */
  useVoiceObservations: () => UseVoiceObservationsResult;
  VoiceOrb: (props: VoiceOrbProps) => ReactElement;
}>;

/**
 * Creates one React extension that adds a shared realtime session, `useVoice`,
 * `useVoiceObservations`, and `VoiceOrb`. Both hooks retain the same session
 * per Orchestrator until the last consumer unmounts. Reading or subscribing
 * through `useVoiceObservations` does not connect the provider.
 * Provider adapters own turn detection and publish their mode
 * through `RealtimeSession`; this layer only reflects retained session state.
 *
 * Configure {@link MaelstromRealtimeOptions.greeting} when each voice session
 * should present a fixed assistant line. The greeting text is exact, spoken at
 * most once per voice session, and acknowledged into Engine history before any
 * speech starts so retries cannot invent a second greeting for the same session.
 *
 * @example
 * ```ts
 * const realtime = maelstromRealtime({
 *   createAdapter: () =>
 *     new OpenAIAdapter({
 *       mintToken: mintOpenAIToken,
 *     }),
 *   greeting: {
 *     text: 'Hello! How can I help?',
 *   },
 * });
 * ```
 */
export function maelstromRealtime(
  options: MaelstromRealtimeOptions,
): RealtimeExtension {
  const sessions = new SharedRealtimeSessionRegistry();

  function getOrCreateSession(
    orchestrator: Orchestrator,
  ): SharedRealtimeSessionEntry {
    return sessions.getOrCreate(orchestrator, (coordinator) => {
      const sessionId = orchestrator.getConfig().sessionId;
      return new RealtimeSession({
        adapter: options.createAdapter({ sessionId }),
        instance: createBridge(orchestrator),
        sessionId,
        summarize: options.summarize,
        groundingDebounceMs: options.groundingDebounceMs,
        onEvent: options.onEvent,
        debug: options.debug,
        conversationInstructions: options.conversationInstructions,
        transcript: options.transcript,
        ...(options.greeting
          ? { greeting: { text: options.greeting.text, coordinator } }
          : {}),
      });
    });
  }

  return (context: MaelstromExtensionContext) => {
    const useVoiceObservations = (): UseVoiceObservationsResult => {
      const { orchestrator } = context.useMaelstromContext();
      const entry = getOrCreateSession(orchestrator);
      const { session } = entry;
      const source = session.observations;
      const snapshot = useSyncExternalStore(
        source.subscribe,
        source.getSnapshot,
        source.getSnapshot,
      );
      useEffect(
        () => sessions.retain(orchestrator, entry),
        [orchestrator, entry],
      );
      return { snapshot, session };
    };
    const useVoice = (): UseVoiceResult => {
      const { orchestrator } = context.useMaelstromContext();
      const entry = getOrCreateSession(orchestrator);
      const { session } = entry;
      const [state, setState] = useState<VoiceSessionState>(session.state);
      const [greetingState, setGreetingState] = useState<GreetingState>(
        session.greetingState,
      );
      const [error, setError] = useState<unknown>(session.lastError);
      const [userTranscript, setUserTranscript] = useState<TranscriptEntry>();
      const [assistantTranscript, setAssistantTranscript] =
        useState<TranscriptEntry>();
      const [turnPolicy, setTurnPolicy] = useState(() =>
        readTurnPolicy(session),
      );

      useEffect(() => {
        const unsubscribe = session.on('state', (next) => {
          setState(next);
          setError(session.lastError);
          setTurnPolicy(readTurnPolicy(session));
        });
        setState(session.state);
        setError(session.lastError);
        return unsubscribe;
      }, [session]);

      useEffect(() => {
        const unsubscribe = session.on('greeting_state', setGreetingState);
        setGreetingState(session.greetingState);
        return unsubscribe;
      }, [session]);

      useEffect(() => {
        const unsubscribe = session.on('turn_mode', () => {
          setTurnPolicy(readTurnPolicy(session));
        });
        setTurnPolicy(readTurnPolicy(session));
        return unsubscribe;
      }, [session]);

      useEffect(() => {
        return session.on('transcript', (transcript) => {
          const update =
            transcript.role === 'user'
              ? setUserTranscript
              : setAssistantTranscript;
          update((previous) => accumulateTranscript(previous, transcript));
        });
      }, [session]);

      useEffect(
        () => sessions.retain(orchestrator, entry),
        [orchestrator, entry],
      );

      const connect = useCallback(() => session.connect(), [session]);
      const disconnect = useCallback(() => session.disconnect(), [session]);
      const skipGreeting = useCallback(() => session.skipGreeting(), [session]);

      return {
        state,
        greetingState,
        error,
        userTranscript,
        assistantTranscript,
        session,
        turnControl: turnPolicy.turnControl,
        turnMode: turnPolicy.mode,
        turnModeError: turnPolicy.error,
        connect,
        disconnect,
        skipGreeting,
      };
    };

    return {
      useVoice,
      useVoiceObservations,
      VoiceOrb: createVoiceOrb(useVoice),
    };
  };
}

function readTurnPolicy(session: RealtimeSession): TurnPolicy {
  return {
    mode: session.turnMode,
    error: session.turnModeError,
    turnControl: session.turnControl,
  };
}

function accumulateTranscript(
  previous: TranscriptEntry | undefined,
  transcript: TranscriptEntry,
): TranscriptEntry {
  if (transcript.final) return transcript;
  const text = previous && !previous.final ? previous.text : '';
  return { role: transcript.role, text: text + transcript.text, final: false };
}

interface TurnPolicy {
  readonly mode: 'automatic' | 'manual';
  readonly error: unknown;
  readonly turnControl: AdapterTurnControl | undefined;
}
