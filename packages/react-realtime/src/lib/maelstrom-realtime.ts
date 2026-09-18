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
  GreetingState,
  RealtimeInstance,
  RealtimeProviderAdapter,
  SummarizeFn,
  VoiceActivationConfig,
  VoiceActivationState,
} from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

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
   * Initial shared voice policy; omission means normal mode, independent of turn detection.
   * Trigger phrases require nonempty normalized words and at most 200 Unicode code points.
   * Inactivity defaults to 10,000 ms (integer 1,000–600,000), after the full turn and
   * playback signals finish; chat participation defaults off. Waiting still captures
   * audio for provider STT and may incur usage. Hooks are fail-open after 2 seconds.
   * Use `configureActivation` for stopped-only edits; trigger mode suppresses greetings.
   */
  readonly activation?: VoiceActivationConfig;
  /**
   * Optional fixed assistant greeting for each voice session.
   *
   * In normal activation mode, `text` is spoken verbatim once per voice session. The shared
   * {@link GreetingCoordinator} acknowledges the line in Engine history before
   * speech starts, so reconnects and remounts do not double-speak a greeting
   * the engine already retained. Trigger mode suppresses it without consuming proof.
   */
  readonly greeting?: { readonly text: string };
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
  /** Shared retained policy, not connection state. Render idle/error before waiting. */
  readonly activationState: VoiceActivationState;
  /** Validated shared settings; preserved across consumer retirement under the same Provider. */
  readonly activationConfig: VoiceActivationConfig;
  /**
   * Replace shared settings only while idle/error and not disconnecting. Throws on
   * live edits or invalid phrase/duration without changing settings. Normal is the
   * default; trigger matching consumes an exact finalized word sequence, never a
   * substring: `Hello, Maelstrom!` matches `hello maelstrom`, an added command does not.
   */
  readonly configureActivation: (config: VoiceActivationConfig) => void;
  /**
   * Begin an independent typed-request token; call and await its idempotent completion
   * in `finally` after submitting. Completion awaits render settlement. Normal mode,
   * chat participation off, or stopped voice is a no-op. Waiting chat never wakes
   * voice; tokens survive wake within their connection, not disconnect/reconnect.
   *
   * @example
   * ```ts
   * const finish = voice.beginChatActivity();
   * try { await processIntent(text); } finally { await finish(); }
   * ```
   */
  readonly beginChatActivity: () => () => Promise<void>;
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
   * shared by every hook consumer, and never disconnects voice. Trigger mode is
   * a no-op and does not consume normal greeting proof.
   */
  readonly skipGreeting: () => void;
}

function createBridge(orchestrator: Orchestrator): RealtimeInstance {
  return {
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
  VoiceOrb: (props: VoiceOrbProps) => ReactElement;
}>;

/**
 * Creates one React extension that adds a shared realtime session, `useVoice`,
 * and `VoiceOrb`. Provider adapters own turn detection and publish their mode
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
    return sessions.getOrCreate(orchestrator, (coordinator, activation) => {
      const sessionId = orchestrator.getConfig().sessionId;
      return new RealtimeSession({
        adapter: options.createAdapter({ sessionId }),
        instance: createBridge(orchestrator),
        sessionId,
        summarize: options.summarize,
        groundingDebounceMs: options.groundingDebounceMs,
        onEvent: options.onEvent,
        debug: options.debug,
        activation: activation ?? options.activation,
        ...(options.greeting
          ? { greeting: { text: options.greeting.text, coordinator } }
          : {}),
      });
    });
  }

  return (context: MaelstromExtensionContext) => {
    const useVoice = (): UseVoiceResult => {
      const { orchestrator } = context.useMaelstromContext();
      const entry = getOrCreateSession(orchestrator);
      const { session } = entry;
      const [state, setState] = useState<VoiceSessionState>(session.state);
      const [greetingState, setGreetingState] = useState<GreetingState>(
        session.greetingState,
      );
      const [error, setError] = useState<unknown>(session.lastError);
      const [activation, setActivation] = useState(() => ({
        state: session.activationState,
        config: session.activationConfig,
      }));
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
        const reflect = () =>
          setActivation({
            state: session.activationState,
            config: session.activationConfig,
          });
        const unsubscribe = session.on('activation_state', reflect);
        reflect();
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
      const configureActivation = useCallback(
        (config: VoiceActivationConfig) => session.configureActivation(config),
        [session],
      );
      const beginChatActivity = useCallback(
        () => session.beginChatActivity(),
        [session],
      );

      return {
        state,
        greetingState,
        activationState: activation.state,
        activationConfig: activation.config,
        configureActivation,
        beginChatActivity,
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

    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
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
