import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Orchestrator, TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import type { MaelstromExtension, MaelstromExtensionContext } from '@maelstrom-co/react';
import type {
  AdapterTurnControl,
  RealtimeInstance,
  RealtimeProviderAdapter,
  SummarizeFn,
} from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import type { SidechannelEvent } from '@maelstrom-co/protocol';

import { createVoiceOrb, type VoiceOrbProps } from './voice-orb.js';

/** Options for {@link maelstromRealtime}. */
export interface MaelstromRealtimeOptions {
  /**
   * Builds the provider transport (OpenAI, Google, …) for a new session.
   * Called once per session creation — not once per render, and not once per
   * `useVoice()` call — so it is safe to do provider setup (token minting
   * closures, etc.) inside it.
   */
  readonly createAdapter: () => RealtimeProviderAdapter;
  /** Overrides the default snapshot-to-sentence grounding summarizer. */
  readonly summarize?: SummarizeFn;
  /** Debounce window for latest-wins grounding pushes. Forwarded to `RealtimeSession`. */
  readonly groundingDebounceMs?: number;
  /** Observes sidechannel events (tool calls, timings, transcripts) for telemetry. */
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enables verbose debug tracing on the underlying `RealtimeSession`. */
  readonly debug?: boolean;
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
   * Escape hatch for advanced consumers (audio streams, sidechannel).
   * Concrete `RealtimeSession` today; a future release may narrow this to
   * the `VoiceSession` seam instead.
   */
  readonly session: RealtimeSession;
  /**
   * Turn-boundary control, present only when the underlying adapter is a
   * push-to-talk cascade (STT→LLM→TTS without server-side VAD) that needs the
   * user to delimit each turn; speech-native adapters leave it `undefined`.
   *
   * `RealtimeSession` never calls it — it is surfaced straight from the
   * adapter to this UI layer. Consumers use `turnControl !== undefined` as the
   * type-level signal to render hold-to-talk controls (driving `startTurn` on
   * press and `endTurn` on release) instead of an always-on listening orb.
   */
  readonly turnControl?: AdapterTurnControl;
  /** Connects the shared session. Safe to call from any consumer under the same Provider. */
  readonly connect: () => Promise<void>;
  /** Disconnects the shared session immediately, regardless of other active consumers. */
  readonly disconnect: () => Promise<void>;
}

function createBridge(orchestrator: Orchestrator): RealtimeInstance {
  return {
    submitIntent: (intent) => orchestrator.processIntent(intent).then(() => {}),
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
 *   maelstromRealtime({ createAdapter: () => new OpenAIAdapter({ mintToken }) }),
 * );
 */
export function maelstromRealtime(
  options: MaelstromRealtimeOptions,
): MaelstromExtension<{
  useVoice: () => UseVoiceResult;
  VoiceOrb: (props: VoiceOrbProps) => ReactElement;
}> {
  // The extension factory runs once, outside React, before any component
  // renders, and the only handle it gets on the orchestrator is the
  // `useMaelstromContext` hook — so the session can't be built here. Instead
  // this map makes the *hook* idempotent: whichever call reaches it first
  // (including a StrictMode remount) creates the session, and every other
  // caller for the same orchestrator reuses it. Keyed on the orchestrator
  // instance (stable for the life of the Provider) rather than a module-level
  // singleton so multiple Maelstrom instances don't share a voice session.
  // `RealtimeSession` doesn't expose the adapter it was built from, so the
  // adapter's `turnControl` capability is captured alongside the session here
  // at creation time and surfaced through the hook.
  const sessions = new WeakMap<Orchestrator, VoiceSessionEntry>();
  const refCounts = new WeakMap<Orchestrator, number>();

  function getOrCreateSession(orchestrator: Orchestrator): VoiceSessionEntry {
    const existing = sessions.get(orchestrator);
    if (existing) return existing;
    const adapter = options.createAdapter();
    const session = new RealtimeSession({
      adapter,
      instance: createBridge(orchestrator),
      sessionId: orchestrator.getConfig().sessionId,
      summarize: options.summarize,
      groundingDebounceMs: options.groundingDebounceMs,
      onEvent: options.onEvent,
      debug: options.debug,
    });
    const entry: VoiceSessionEntry = { session, turnControl: adapter.turnControl };
    sessions.set(orchestrator, entry);
    return entry;
  }

  return (ctx: MaelstromExtensionContext) => {
    const useVoice = (): UseVoiceResult => {
      const { orchestrator } = ctx.useMaelstromContext();
      const { session, turnControl } = getOrCreateSession(orchestrator);

      // Seeded from the session's current state rather than a hardcoded
      // 'idle' — a subscriber mounting after another one already connected
      // the shared session must not render a stale status.
      const [state, setState] = useState<VoiceSessionState>(session.state);
      const [error, setError] = useState<unknown>(session.lastError);
      const [userTranscript, setUserTranscript] = useState<TranscriptEntry | undefined>(undefined);
      const [assistantTranscript, setAssistantTranscript] = useState<TranscriptEntry | undefined>(
        undefined,
      );

      useEffect(() => {
        return session.on('state', (next) => {
          setState(next);
          setError(session.lastError);
        });
      }, [session]);

      useEffect(() => {
        return session.on('transcript', (entry) => {
          const setTranscript = entry.role === 'user' ? setUserTranscript : setAssistantTranscript;
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

      // Refcounted so a StrictMode fake-unmount (or any other subscriber
      // still holding the hook) doesn't tear down a session that's still in
      // use — only the last subscriber to unmount disconnects it. The map
      // entry is left in place (not deleted) so a later remount or another
      // component still gets this same instance rather than a fresh one.
      useEffect(() => {
        const count = (refCounts.get(orchestrator) ?? 0) + 1;
        refCounts.set(orchestrator, count);
        return () => {
          const remaining = (refCounts.get(orchestrator) ?? 1) - 1;
          refCounts.set(orchestrator, remaining);
          if (remaining <= 0) {
            void session.disconnect();
          }
        };
      }, [orchestrator, session]);

      const connect = useCallback(() => session.connect(), [session]);
      const disconnect = useCallback(() => session.disconnect(), [session]);

      return {
        state,
        error,
        userTranscript,
        assistantTranscript,
        session,
        turnControl,
        connect,
        disconnect,
      };
    };

    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
  };
}

/**
 * Shared-session record kept per orchestrator: the `RealtimeSession` plus the
 * `turnControl` snapshotted off its adapter at creation, since the session
 * itself doesn't re-expose the adapter.
 */
interface VoiceSessionEntry {
  readonly session: RealtimeSession;
  readonly turnControl: AdapterTurnControl | undefined;
}
