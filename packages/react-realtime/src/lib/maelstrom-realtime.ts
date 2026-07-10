import { useCallback, useEffect, useState } from 'react';
import type { Orchestrator, TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import type { MaelstromExtension, MaelstromExtensionContext } from '@maelstrom-co/react';
import type { RealtimeInstance, RealtimeProviderAdapter, SummarizeFn } from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import type { SidechannelEvent } from '@maelstrom-co/protocol';

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
  /** Escape hatch for advanced consumers (audio streams, sidechannel). */
  readonly session: RealtimeSession;
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
 *   maelstromRealtime({ createAdapter: () => createOpenAiAdapter({ mintToken }) }),
 * );
 */
export function maelstromRealtime(
  options: MaelstromRealtimeOptions,
): MaelstromExtension<{ useVoice: () => UseVoiceResult }> {
  // The extension factory runs once, outside React, before any component
  // renders, and the only handle it gets on the orchestrator is the
  // `useMaelstromContext` hook — so the session can't be built here. Instead
  // this map makes the *hook* idempotent: whichever call reaches it first
  // (including a StrictMode remount) creates the session, and every other
  // caller for the same orchestrator reuses it. Keyed on the orchestrator
  // instance (stable for the life of the Provider) rather than a module-level
  // singleton so multiple Maelstrom instances don't share a voice session.
  const sessions = new WeakMap<Orchestrator, RealtimeSession>();
  const refCounts = new WeakMap<Orchestrator, number>();

  function getOrCreateSession(orchestrator: Orchestrator): RealtimeSession {
    const existing = sessions.get(orchestrator);
    if (existing) return existing;
    const session = new RealtimeSession({
      adapter: options.createAdapter(),
      instance: createBridge(orchestrator),
      sessionId: orchestrator.getConfig().sessionId,
      summarize: options.summarize,
      groundingDebounceMs: options.groundingDebounceMs,
      onEvent: options.onEvent,
      debug: options.debug,
    });
    sessions.set(orchestrator, session);
    return session;
  }

  return (ctx: MaelstromExtensionContext) => ({
    useVoice: (): UseVoiceResult => {
      const { orchestrator } = ctx.useMaelstromContext();
      const session = getOrCreateSession(orchestrator);

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
        connect,
        disconnect,
      };
    },
  });
}
