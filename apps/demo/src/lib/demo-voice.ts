import type { Orchestrator } from '@maelstrom-co/client';
import type {
  RealtimeOpening,
  RealtimeSessionContext,
  RealtimeSessionInit,
} from '@maelstrom-co/react-realtime';
import {
  type RealtimeProviderAdapter,
  type RealtimeSession,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { diagnosticCapture } from './diagnostic-capture';
import { VoiceDiagnostics } from './voice-diagnostics';
import {
  type DemoVoiceProvider,
  LIVE_BACKEND_MODEL,
  LIVE_MODEL,
} from './voice-provider';

export const LIVE_OPENING_INSTRUCTIONS =
  'In English, briefly introduce yourself as Maelstrom and offer to arrange this workspace.';

export interface DemoVoiceSession {
  readonly provider: DemoVoiceProvider;
  readonly providerInstanceId: string;
  readonly adapter: RealtimeProviderAdapter;
  readonly diagnostics: VoiceDiagnostics;
}

/** Live generates its own introduction; the other providers speak the fixed greeting. */
export function demoVoiceOpening(
  greeting: string,
): (context: RealtimeSessionInit<DemoVoiceProvider>) => RealtimeOpening {
  return ({ provider }) =>
    provider === 'live'
      ? { generatedOpening: { instructions: LIVE_OPENING_INSTRUCTIONS } }
      : { greeting: { text: greeting } };
}

/**
 * Attaches demo diagnostics and local capture to a session the library built.
 * Tool events and captured session events stay recorded for the session's
 * whole life, because an update can settle after End voice or a provider
 * switch; the returned cleanup releases only the lifecycle and observation
 * views.
 */
export function attachDemoVoice(
  session: RealtimeSession,
  context: RealtimeSessionContext<DemoVoiceProvider>,
): () => void {
  const { provider, adapter } = context;
  const providerInstanceId = context.instanceId;
  currentInstances.set(context.orchestrator, providerInstanceId);
  const diagnostics = diagnosticsFor(context.orchestrator);
  sessions.set(session, {
    provider,
    providerInstanceId,
    adapter,
    diagnostics,
  });

  let toolGeneration = 0;
  session.events.subscribe((event) => {
    if (event.type === 'session.started') toolGeneration = event.generation;
    diagnosticCapture.sessionEvent(event, {
      provider,
      providerInstanceId,
      generation: toolGeneration,
    });
    if (event.type === 'tool.called' || event.type === 'tool.result')
      diagnostics.onSessionEvent(event, {
        provider,
        providerInstanceId,
        generation: toolGeneration,
      });
  });

  const retainTransport = () => {
    if (adapter instanceof OpenAILiveAdapter)
      diagnostics.retainTransport(adapter.getTransportSnapshot(), {
        providerInstanceId,
        model: LIVE_MODEL,
        backendModel: LIVE_BACKEND_MODEL,
      });
  };
  let generation = 0;
  const releases = [
    session.observations.subscribe(() =>
      diagnosticCapture.observations(session.observations.getSnapshot(), {
        provider,
        providerInstanceId,
      }),
    ),
    session.events.subscribe((event) => {
      if (event.type === 'session.started') generation = event.generation;
      if (event.type !== 'tool.called' && event.type !== 'tool.result')
        diagnostics.onSessionEvent(event, { provider, providerInstanceId });
    }),
    session.on('state', (state) => {
      const error = session.lastError;
      const cause = error instanceof RealtimeVoiceError ? error.cause : error;
      if (
        state === 'error' ||
        state === 'listening' ||
        state === 'thinking' ||
        state === 'speaking'
      )
        diagnostics.record({
          at: Date.now(),
          kind: state === 'error' ? 'voice_error' : 'voice_state',
          provider,
          providerInstanceId,
          state,
          generation,
          status:
            cause instanceof LiveTransportError ? cause.status : undefined,
        });
      if (state === 'error' || state === 'idle') retainTransport();
    }),
  ];
  return () => {
    for (const release of releases) release();
  };
}

/** Demo wiring of a session built by the library, or undefined for a foreign one. */
export function demoVoiceSession(
  session: RealtimeSession,
): DemoVoiceSession | undefined {
  return sessions.get(session);
}

const sessions = new WeakMap<RealtimeSession, DemoVoiceSession>();
const diagnosticsByOrchestrator = new WeakMap<Orchestrator, VoiceDiagnostics>();
const currentInstances = new WeakMap<Orchestrator, string>();

function diagnosticsFor(orchestrator: Orchestrator): VoiceDiagnostics {
  const existing = diagnosticsByOrchestrator.get(orchestrator);
  if (existing) return existing;
  const diagnostics = new VoiceDiagnostics();
  diagnosticsByOrchestrator.set(orchestrator, diagnostics);
  orchestrator.onSettled(() => {
    diagnosticCapture.record('application_settled', {
      sessionId: orchestrator.getConfig().sessionId,
      providerInstanceId: currentInstances.get(orchestrator),
      snapshot: orchestrator.getStructuralSnapshot(),
    });
  });
  const requests = orchestrator.requestCoordinator.events;
  requests.on('processing_started', (event) =>
    diagnostics.record({
      at: Date.now(),
      kind: 'engine_started',
      id: event.requestId,
    }),
  );
  requests.on('processing_completed', (event) =>
    diagnostics.record({
      at: Date.now(),
      kind: 'engine_completed',
      id: event.requestId,
      durationMs: event.durationMs,
    }),
  );
  requests.on('error', () =>
    diagnostics.record({ at: Date.now(), kind: 'engine_error' }),
  );
  return diagnostics;
}
