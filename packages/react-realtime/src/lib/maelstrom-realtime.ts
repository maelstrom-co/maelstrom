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
import { type ReactElement, useCallback, useEffect, useState } from 'react';

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
}

/** Return value of the `useVoice()` hook added by {@link maelstromRealtime}. */
export interface UseVoiceResult {
  /** Lifecycle state of the shared session, updated for every consumer. */
  readonly state: VoiceSessionState;
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
  /** Connects the shared session; concurrent lifecycle safety is session-owned. */
  readonly connect: () => Promise<void>;
  /** Disconnects the shared session regardless of other mounted consumers. */
  readonly disconnect: () => Promise<void>;
}

function createBridge(orchestrator: Orchestrator): RealtimeInstance {
  return {
    submitIntent: (intent) =>
      orchestrator
        .processIntent(intent)
        .then((response) => ({ userMessage: response.userMessage })),
    waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (callback) => orchestrator.onSettled(callback),
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
 */
export function maelstromRealtime(
  options: MaelstromRealtimeOptions,
): RealtimeExtension {
  const sessions = new WeakMap<Orchestrator, VoiceSessionEntry>();

  function getOrCreateSession(orchestrator: Orchestrator): VoiceSessionEntry {
    const existing = sessions.get(orchestrator);
    if (existing) return existing;

    const sessionId = orchestrator.getConfig().sessionId;
    const session = new RealtimeSession({
      adapter: options.createAdapter({ sessionId }),
      instance: createBridge(orchestrator),
      sessionId,
      summarize: options.summarize,
      groundingDebounceMs: options.groundingDebounceMs,
      onEvent: options.onEvent,
      debug: options.debug,
    });
    const entry: VoiceSessionEntry = {
      session,
      consumerCount: 0,
      phase: 'live',
      retirementQueued: false,
    };
    sessions.set(orchestrator, entry);
    return entry;
  }

  return (context: MaelstromExtensionContext) => {
    const useVoice = (): UseVoiceResult => {
      const { orchestrator } = context.useMaelstromContext();
      const entry = getOrCreateSession(orchestrator);
      const { session } = entry;
      const [state, setState] = useState<VoiceSessionState>(session.state);
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

      useEffect(() => {
        entry.consumerCount += 1;
        return () => {
          entry.consumerCount = Math.max(0, entry.consumerCount - 1);
          queueRetirement(orchestrator, entry, sessions);
        };
      }, [orchestrator, entry]);

      const connect = useCallback(() => session.connect(), [session]);
      const disconnect = useCallback(() => session.disconnect(), [session]);

      return {
        state,
        error,
        userTranscript,
        assistantTranscript,
        session,
        turnControl: turnPolicy.turnControl,
        turnMode: turnPolicy.mode,
        turnModeError: turnPolicy.error,
        connect,
        disconnect,
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

function queueRetirement(
  orchestrator: Orchestrator,
  entry: VoiceSessionEntry,
  sessions: WeakMap<Orchestrator, VoiceSessionEntry>,
): void {
  if (entry.retirementQueued) return;
  entry.retirementQueued = true;
  queueMicrotask(() => {
    entry.retirementQueued = false;
    if (entry.phase !== 'live' || entry.consumerCount > 0) return;

    entry.phase = 'retired';
    if (sessions.get(orchestrator) === entry) sessions.delete(orchestrator);
    void entry.session.disconnect().catch(() => {});
  });
}

interface TurnPolicy {
  readonly mode: 'automatic' | 'manual';
  readonly error: unknown;
  readonly turnControl: AdapterTurnControl | undefined;
}

interface VoiceSessionEntry {
  readonly session: RealtimeSession;
  consumerCount: number;
  phase: 'live' | 'retired';
  retirementQueued: boolean;
}
