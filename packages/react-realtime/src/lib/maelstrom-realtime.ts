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
  GreetingCoordinator,
  GreetingState,
  RealtimeProviderAdapter,
  RealtimeSessionMemory,
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

import { createRealtimeInstance } from './realtime-instance.js';
import {
  type SharedRealtimeSessionBuild,
  SharedRealtimeSessionRegistry,
  type SharedRealtimeSessionView,
} from './shared-realtime-session.js';
import { createVoiceOrb, type VoiceOrbProps } from './voice-orb.js';

/**
 * What a session the extension builds is for: the Maelstrom session and the
 * voice provider. Passed to {@link MaelstromRealtimeBaseOptions.createAdapter}
 * and to the `opening` option.
 */
export interface RealtimeSessionInit<Provider = undefined> {
  /**
   * Maelstrom session identifier, used to scope provider-side resources. It
   * stays the same across provider switches and remounts.
   */
  readonly sessionId: SessionId;
  /**
   * Voice provider this session is built for: the initial provider, or the
   * one chosen through {@link UseVoiceResult.switchProvider}. `undefined`
   * when the extension declares no provider.
   */
  readonly provider: Provider;
}

/** Context passed to {@link MaelstromRealtimeBaseOptions.createAdapter}. */
export type CreateAdapterContext<Provider = undefined> =
  RealtimeSessionInit<Provider>;

/**
 * Context passed to {@link MaelstromRealtimeBaseOptions.onSession} for one
 * built session.
 */
export interface RealtimeSessionContext<Provider = undefined>
  extends RealtimeSessionInit<Provider> {
  /** Orchestrator whose shared session this is. */
  readonly orchestrator: Orchestrator;
  /**
   * Random identifier of this one built session. Unlike `sessionId`, it
   * changes on every provider switch and on every rebuild after the last
   * consumer unmounts, so diagnostics can tell provider instances apart.
   */
  readonly instanceId: string;
  /**
   * The adapter {@link MaelstromRealtimeBaseOptions.createAdapter} returned
   * for this session, for provider-specific calls the session does not
   * expose.
   */
  readonly adapter: RealtimeProviderAdapter;
}

/**
 * How a session opens: a fixed greeting spoken verbatim, or a generated
 * introduction. Both share one introduction per Maelstrom session, including
 * across provider switches: once either was attempted, neither runs again.
 */
export type RealtimeOpening =
  | {
      /** Fixed assistant line, acknowledged in Engine history before speech. */
      readonly greeting: { readonly text: string };
      /** Excluded: choose one opening. */
      readonly generatedOpening?: never;
    }
  | {
      /** Natural introduction; use an explicit language in these trusted instructions. */
      readonly generatedOpening: { readonly instructions: string };
      /** Excluded: choose one opening. */
      readonly greeting?: never;
    };

/** Options shared by every opening configuration of {@link maelstromRealtime}. */
export interface MaelstromRealtimeBaseOptions<Provider = undefined> {
  /**
   * Voice providers this extension can switch between, for example
   * `['live', 'realtime']`. The list types
   * {@link UseVoiceResult.switchProvider}, which rejects any other value.
   * An empty list throws `RangeError`. Omit it for a single-provider extension.
   */
  readonly providers?: readonly Provider[];
  /**
   * Provider of each Orchestrator's first session; defaults to the first
   * entry of `providers`. A function is read lazily, when that first session
   * is built. Afterwards the extension remembers the last chosen provider per
   * Orchestrator, so a remount keeps it.
   * When `providers` is set, the selection must belong to that list; an unknown
   * value throws `RangeError` before the first adapter is built.
   */
  readonly initialProvider?: Provider | (() => Provider);
  /** Conversation-only instructions for providers with a separate managed tool backend. */
  readonly conversationInstructions?: string;
  /** Bounds and grouping policy for the opt-in continuous transcript channel. */
  readonly transcript?: ContinuousTranscriptOptions;
  /**
   * Builds one provider adapter for each shared session. The factory receives
   * the orchestrator session identifier and the provider, and is not called
   * per render or hook. If building the session fails after it returns, the
   * adapter is disconnected.
   */
  readonly createAdapter: (
    context: CreateAdapterContext<Provider>,
  ) => RealtimeProviderAdapter;
  /**
   * Attaches app wiring, such as diagnostics subscriptions on
   * {@link RealtimeSession.events}, to each session the extension builds. It
   * runs once per session, synchronously while the session is built, which
   * can happen during render, so it must not update React state directly.
   * An optional returned cleanup runs after the session has disconnected, when a
   * provider switch replaces it or its last consumer unmounts. Subscriptions
   * the cleanup leaves in place keep observing the retired session, which
   * still reports requests that settle late. Throwing aborts the build.
   */
  readonly onSession?: (
    session: RealtimeSession,
    context: RealtimeSessionContext<Provider>,
    // biome-ignore lint/suspicious/noConfusingVoidType: Optional cleanup must accept callbacks with no return statement.
  ) => (() => void) | void;
  /** Overrides the deterministic structural-summary fallback. */
  readonly summarize?: SummarizeFn;
  /** Debounce window for latest-wins grounding pushes. */
  readonly groundingDebounceMs?: number;
  /**
   * Observes the stable, additive-only sidechannel stream of every session:
   * tool calls and results, transcripts and `update_ui` timings. Turn-mode
   * diagnostics are excluded.
   */
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enables verbose tracing in the underlying session. */
  readonly debug?: boolean;
}

/** Opening chosen per provider; excludes the fixed opening options. */
export interface MaelstromRealtimeOpeningOptions<Provider = undefined> {
  /**
   * Chooses the opening of each built session from its provider, so one
   * extension can greet on one provider and generate an introduction on
   * another. Return `undefined` for no opening.
   */
  readonly opening: (
    context: RealtimeSessionInit<Provider>,
  ) => RealtimeOpening | undefined;
  /** Excluded: `opening` decides the greeting. */
  readonly greeting?: never;
  /** Excluded: `opening` decides the generated opening. */
  readonly generatedOpening?: never;
}

/** One fixed opening for every session the extension builds. */
export interface MaelstromRealtimeFixedOpeningOptions {
  /** Excluded: use the fixed options or `opening`, not both. */
  readonly opening?: never;
  /** Optional natural introduction with an explicit language. One attempt per Maelstrom session, retained across remounts; cannot accompany greeting. */
  readonly generatedOpening?: { readonly instructions: string };
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

/** Options for {@link maelstromRealtime}. */
export type MaelstromRealtimeOptions<Provider = undefined> =
  MaelstromRealtimeBaseOptions<Provider> &
    (
      | MaelstromRealtimeOpeningOptions<Provider>
      | MaelstromRealtimeFixedOpeningOptions
    );

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
export interface UseVoiceResult<Provider = undefined> {
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
  /** Latest accumulated or final user transcript; reset when the session is replaced. */
  readonly userTranscript: TranscriptEntry | undefined;
  /** Latest accumulated or final assistant transcript; reset when the session is replaced. */
  readonly assistantTranscript: TranscriptEntry | undefined;
  /**
   * Advanced access to the shared realtime session and its audio streams. A
   * provider switch replaces it, and every consumer re-renders with the new one.
   */
  readonly session: RealtimeSession;
  /** Provider of the current session. */
  readonly provider: Provider;
  /** True from the start of a provider switch until it commits, fails, or is superseded. */
  readonly switching: boolean;
  /**
   * Switches every consumer to a new session for `provider`. The current
   * session disconnects first, then the extension builds the new adapter and
   * session with the same recovery memory and greeting coordinator, so the
   * one-introduction rule holds across providers. Transcripts reset.
   *
   * Resolves once the request settles; read `provider` for the outcome. The
   * current provider resolves at once, a second call for the pending target
   * shares its promise, and a call for another target supersedes it, so the
   * earlier request resolves without building. Rejects when the old session
   * fails to disconnect or the new one fails to build, leaving the current
   * session in place, disconnected. Rejects with a `RangeError` for a
   * provider missing from {@link MaelstromRealtimeBaseOptions.providers}.
   * With no mounted consumer, the choice is remembered for the next session.
   */
  readonly switchProvider: (provider: Provider) => Promise<void>;
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
   * be a no-op, and it resolves without connecting while a provider switch runs.
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

type RealtimeExtension<Provider> = MaelstromExtension<{
  useVoice: () => UseVoiceResult<Provider>;
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
 * Configure {@link MaelstromRealtimeFixedOpeningOptions.greeting} when each
 * voice session should present a fixed assistant line. The greeting text is
 * exact, spoken at most once per voice session, and acknowledged into Engine
 * history before any speech starts so retries cannot invent a second greeting
 * for the same session.
 *
 * To switch providers at runtime, list them in `providers`, build the adapter
 * from `context.provider`, choose the opening per provider with `opening`,
 * and call `switchProvider` from `useVoice()`. The extension is the only
 * place that builds sessions; attach app wiring through `onSession`.
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
 *
 * @example
 * ```ts
 * const realtime = maelstromRealtime({
 *   providers: ['live', 'realtime'],
 *   createAdapter: ({ provider }) =>
 *     provider === 'live' ? createLiveAdapter() : createRealtimeAdapter(),
 *   opening: ({ provider }) =>
 *     provider === 'live'
 *       ? { generatedOpening: { instructions: 'In English, introduce yourself.' } }
 *       : { greeting: { text: 'Hello! How can I help?' } },
 * });
 * // In a component:
 * const { provider, switching, switchProvider } = realtime.useVoice();
 * ```
 */
export function maelstromRealtime<
  Provider extends string | undefined = undefined,
>(
  options: MaelstromRealtimeOptions<NoInfer<Provider>> & {
    readonly providers?: readonly Provider[];
  },
): RealtimeExtension<Provider>;
/** Infers a single provider from its initial selection when no provider list is supplied. */
export function maelstromRealtime<
  Provider extends string | undefined = undefined,
>(
  options: MaelstromRealtimeOptions<Provider> & {
    readonly providers?: undefined;
  },
): RealtimeExtension<Provider>;
export function maelstromRealtime<
  Provider extends string | undefined = undefined,
>(options: MaelstromRealtimeOptions<Provider>): RealtimeExtension<Provider> {
  if (options.opening && (options.greeting || options.generatedOpening))
    throw new Error('Choose opening, or greeting and generatedOpening');
  const { providers } = options;
  if (providers?.length === 0)
    throw new RangeError('providers must contain at least one provider');
  const sessions = new SharedRealtimeSessionRegistry<Provider>({
    initialProvider: () =>
      resolveInitialProvider(options.initialProvider, providers),
    build: (request) => buildSession(options, request),
  });

  return (context: MaelstromExtensionContext) => {
    const useSessionView = (
      orchestrator: Orchestrator,
    ): SharedRealtimeSessionView<Provider> => {
      const subscribe = useCallback(
        (listener: () => void) => sessions.subscribe(orchestrator, listener),
        [orchestrator],
      );
      const read = useCallback(
        () => sessions.read(orchestrator),
        [orchestrator],
      );
      return useSyncExternalStore(subscribe, read, read);
    };
    const useVoiceObservations = (): UseVoiceObservationsResult => {
      const { orchestrator } = context.useMaelstromContext();
      const { entry } = useSessionView(orchestrator);
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
    const useVoice = (): UseVoiceResult<Provider> => {
      const { orchestrator } = context.useMaelstromContext();
      const { entry, provider, switching } = useSessionView(orchestrator);
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
        setUserTranscript(undefined);
        setAssistantTranscript(undefined);
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

      const connect = useCallback(
        () => sessions.connect(orchestrator),
        [orchestrator],
      );
      const disconnect = useCallback(
        () => sessions.disconnect(orchestrator),
        [orchestrator],
      );
      const skipGreeting = useCallback(
        () => sessions.skipGreeting(orchestrator),
        [orchestrator],
      );
      const switchProvider = useCallback(
        (next: Provider): Promise<void> => {
          if (providers && !providers.includes(next))
            return Promise.reject(
              new RangeError(`Unknown voice provider: ${String(next)}`),
            );
          return sessions.switchProvider(orchestrator, next);
        },
        [orchestrator],
      );

      return {
        state,
        greetingState,
        error,
        userTranscript,
        assistantTranscript,
        session,
        provider,
        switching,
        switchProvider,
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

function resolveInitialProvider<Provider>(
  initial: Provider | (() => Provider) | undefined,
  providers: readonly Provider[] | undefined,
): Provider {
  const provider =
    typeof initial === 'function'
      ? (initial as () => Provider)()
      : (initial ?? providers?.[0]);
  if (providers && !providers.includes(provider as Provider))
    throw new RangeError(`Unknown voice provider: ${String(provider)}`);
  return provider as Provider;
}

function buildSession<Provider>(
  options: MaelstromRealtimeOptions<Provider>,
  request: {
    readonly orchestrator: Orchestrator;
    readonly coordinator: GreetingCoordinator;
    readonly memory: RealtimeSessionMemory;
    readonly provider: Provider;
  },
): SharedRealtimeSessionBuild {
  const { orchestrator, coordinator, memory, provider } = request;
  const sessionId = memory.sessionId;
  const init: RealtimeSessionInit<Provider> = { sessionId, provider };
  const adapter = options.createAdapter(init);
  try {
    const opening = options.opening
      ? options.opening(init)
      : {
          greeting: options.greeting,
          generatedOpening: options.generatedOpening,
        };
    // A skipped or Engine-suppressed fixed greeting never claims memory, yet
    // it still counts as this Maelstrom session's introduction.
    const generatedOpening =
      opening?.generatedOpening &&
      coordinator.getSnapshot(sessionId).lifecycle !== 'terminal'
        ? opening.generatedOpening
        : undefined;
    const session = new RealtimeSession({
      adapter,
      instance: createRealtimeInstance(orchestrator),
      sessionId,
      memory,
      ...(generatedOpening ? { generatedOpening } : {}),
      summarize: options.summarize,
      groundingDebounceMs: options.groundingDebounceMs,
      onEvent: options.onEvent,
      debug: options.debug,
      conversationInstructions: options.conversationInstructions,
      transcript: options.transcript,
      ...(opening?.greeting
        ? { greeting: { text: opening.greeting.text, coordinator } }
        : {}),
    });
    const release = options.onSession?.(session, {
      ...init,
      orchestrator,
      instanceId: crypto.randomUUID(),
      adapter,
    });
    return {
      session,
      release: typeof release === 'function' ? release : undefined,
    };
  } catch (error) {
    releaseAdapter(adapter);
    throw error;
  }
}

function releaseAdapter(adapter: RealtimeProviderAdapter): void {
  try {
    void adapter.disconnect().catch(() => {});
  } catch {
    // The build failure is the error worth reporting.
  }
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
