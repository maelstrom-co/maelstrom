import type { VoiceObservationSnapshot } from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import type { SessionEvent } from '@maelstrom-co/realtime';
import { engineMetadata } from './engine-metadata';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import { LIVE_BACKEND_MODEL, LIVE_MODEL } from './voice-provider';

type Fields = Record<string, unknown>;
const MAX_EVENTS = 1000;
const MAX_CHARACTERS = 2_000_000;

function object(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class DiagnosticCapture {
  private listeners = new Set<() => void>();
  private state: {
    active: boolean;
    count: number;
    dropped: number;
    outcome: string;
    mode?: string;
  } = { active: false, count: 0, dropped: 0, outcome: '' };
  private startedAt = 0;
  private startedMono = 0;
  private characters = 0;
  private entries: Fields[] = [];
  private metadata: Fields = {};
  private fragments = new Map<string, string>();
  private work = '';
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  constructor(private readonly getKey: () => string | null = () => null) {}

  private notify() {
    for (const listener of this.listeners) listener();
  }

  start(mode: string, sessionId: string, providerInstanceId: string) {
    this.clear();
    this.startedAt = Date.now();
    this.startedMono = performance.now();
    this.metadata = {
      mode,
      sessionId,
      providerInstanceId,
      startedAt: new Date(this.startedAt).toISOString(),
      localDate: new Date(this.startedAt).toLocaleDateString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      voiceModel: mode === 'live' ? LIVE_MODEL : null,
      voiceModelSource: mode === 'live' ? 'configured' : 'unobserved',
      defaultVoiceModel:
        mode === 'realtime' ? DEFAULT_REALTIME_MODEL : undefined,
      managedModel: mode === 'live' ? LIVE_BACKEND_MODEL : null,
      engineModel:
        engineMetadata.getSnapshot()?.engineModel ??
        'unobserved: server-owned configuration',
      engineModelSource: engineMetadata.getSnapshot()?.source ?? 'unobserved',
    };
    this.state = { active: true, count: 0, dropped: 0, outcome: '', mode };
    this.record('capture_started', { mode });
  }

  stop() {
    if (!this.state.active) return;
    this.record('capture_stopped', {});
    this.state = { ...this.state, active: false };
    this.fragments.clear();
    this.notify();
  }

  clear() {
    this.entries = [];
    this.metadata = {};
    this.fragments.clear();
    this.work = '';
    this.characters = 0;
    this.state = { active: false, count: 0, dropped: 0, outcome: '' };
    this.notify();
  }

  private clean(value: unknown): unknown {
    const key = this.getKey();
    return JSON.parse(
      JSON.stringify(value, (_name, field: unknown) => {
        if (typeof field !== 'string') return field;
        const redacted = (key ? field.replaceAll(key, '[REDACTED]') : field)
          .replace(/\bsk-[a-zA-Z0-9_-]{32,}/g, '[REDACTED]')
          .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
        return redacted.length > 16_384
          ? `${redacted.slice(0, 16_384)} [TRUNCATED]`
          : redacted;
      }),
    );
  }

  record(kind: string, fields: Fields) {
    if (!this.state.active) return;
    try {
      const entry = this.clean({
        entryId: crypto.randomUUID(),
        kind,
        at: Date.now(),
        elapsedMs: performance.now() - this.startedMono,
        ...fields,
      }) as Fields;
      const size = JSON.stringify(entry).length;
      if (
        this.entries.length >= MAX_EVENTS ||
        this.characters + size > MAX_CHARACTERS
      ) {
        this.state = { ...this.state, dropped: this.state.dropped + 1 };
      } else {
        this.characters += size;
        this.entries.push(entry);
        this.state = { ...this.state, count: this.entries.length };
      }
      this.notify();
    } catch {
      // Capture must not change application or provider behavior.
    }
  }

  sessionEvent(event: SessionEvent, identity: Fields) {
    if (!this.state.active) return;
    if (event.type === 'tool.called') {
      let intent: string | undefined;
      try {
        intent = text(object(JSON.parse(event.argumentsJson)).intent);
      } catch {
        /* Invalid arguments remain observable as a tool call. */
      }
      this.record('tool_call', {
        ...identity,
        callId: event.callId,
        tool: event.name,
        intent,
      });
    } else if (event.type === 'tool.result') {
      this.record('tool_result', {
        ...identity,
        callId: event.callId,
        ok: event.ok,
        durationMs: event.latencyMs,
      });
    } else if (event.type === 'transcript.entry') {
      this.record('transcript', {
        ...identity,
        role: event.role,
        text: event.text,
        final: event.final,
      });
    }
  }

  observations(
    snapshot: VoiceObservationSnapshot,
    identity: Fields,
    initial = false,
  ) {
    if (!this.state.active) return;
    const work = JSON.stringify([
      identity,
      snapshot.generation,
      snapshot.connection,
      snapshot.media,
      snapshot.applicationWork,
    ]);
    if (work !== this.work) {
      this.work = work;
      this.record(initial ? 'initial_observations' : 'observations', {
        ...identity,
        generation: snapshot.generation,
        connection: snapshot.connection,
        media: snapshot.media,
        applicationWork: snapshot.applicationWork,
      });
    }
    for (const fragment of snapshot.fragments) {
      const id = `${identity.providerInstanceId}:${snapshot.generation}:${fragment.id}`;
      const value = JSON.stringify(fragment);
      if (this.fragments.get(id) === value) continue;
      this.fragments.set(id, value);
      if (initial) continue;
      this.record('transcript_fragment', {
        ...identity,
        generation: snapshot.generation,
        fragment,
      });
    }
    while (this.fragments.size > 512) {
      const first = this.fragments.keys().next().value;
      if (first !== undefined) this.fragments.delete(first);
    }
  }

  engineRequest(message: ChartRequestMessage) {
    this.record('engine_request', {
      engineModel: engineMetadata.getSnapshot()?.engineModel,
      engineModelSource: engineMetadata.getSnapshot()?.source,
      requestId: message.id,
      sessionId: message.sessionId,
      reasons: message.request.context.updateReasons,
    });
  }

  engineResponse(
    requestId: string,
    response: MaelstromResponse,
    durationMs: number,
  ) {
    this.record('engine_response', {
      requestId,
      durationMs,
      userMessage: response.userMessage,
      executionPlan: response.executionPlan,
    });
  }

  liveWire(raw: unknown, direction: 'received' | 'sent', peerId: string) {
    if (!this.state.active || typeof raw !== 'string' || raw.length > 262_144)
      return;
    try {
      const envelope = object(JSON.parse(raw));
      const type = text(envelope.type);
      const event = object(envelope.event);
      const eventType = text(event.type);
      if (
        !type ||
        !/^(session\.delegation\.|session\.thinking\.append(?:ed)?$|response\.)/.test(
          type,
        )
      )
        return;
      if (eventType?.endsWith('.delta')) return;
      const response = object(event.response);
      const delegation = object(envelope.delegation);
      const item = object(event.item ?? envelope.item);
      let intent: string | undefined;
      if (item.type === 'function_call' && typeof item.arguments === 'string') {
        try {
          intent = text(object(JSON.parse(item.arguments)).intent);
        } catch {
          /* Keep timing for malformed calls. */
        }
      }
      this.record('live_wire', {
        direction,
        peerId,
        type,
        eventType,
        eventId: text(envelope.event_id),
        clientEventId: text(envelope.client_event_id),
        contextKind:
          type === 'session.thinking.append' && direction === 'sent'
            ? text(envelope.content)?.startsWith('Observed UI data')
              ? 'ui_snapshot'
              : text(envelope.content)?.startsWith('Observed application data')
                ? 'recovery_outcome'
                : 'other'
            : undefined,
        snapshotRevision:
          type === 'session.thinking.append' && direction === 'sent'
            ? text(envelope.content)?.match(/UI snapshot r(\d+)/)?.[1]
            : undefined,
        delegationId: text(envelope.delegation_id) ?? text(delegation.id),
        responseId:
          text(event.response_id) ??
          text(response.id) ??
          text(envelope.response_id) ??
          text(delegation.response_id),
        callId: text(item.call_id),
        tool: item.type === 'function_call' ? text(item.name) : undefined,
        intent,
        status: text(response.status),
      });
    } catch {
      /* Raw transport errors and session configuration are never captured. */
    }
  }

  setOutcome(outcome: string) {
    this.state = {
      ...this.state,
      outcome: String(this.clean(outcome.slice(0, 4000))),
    };
    this.notify();
  }

  export(outcome = this.state.outcome) {
    return JSON.stringify(
      this.clean({
        schemaVersion: 1,
        metadata: this.metadata,
        outcome,
        active: this.state.active,
        droppedEvents: this.state.dropped,
        limits: {
          events: MAX_EVENTS,
          characters: MAX_CHARACTERS,
          stringCharacters: 16_384,
        },
        limitations: [
          'Browser receipt times, not provider execution times or proof of audibility.',
          'Provider delegation task content and server-side model retries are not exposed.',
          'Native provider call IDs and application call IDs are separate; no inferred mapping.',
          'Capture metadata does not alter prompts. Engine user intents carry separate request-time browser calendar context.',
        ],
        events: this.entries,
      }),
      null,
      2,
    );
  }
}

export const diagnosticCapture = new DiagnosticCapture(
  () => playgroundKeyStore.state.apiKey,
);

export function createDiagnosticPeer(): RTCPeerConnection {
  const peer = new RTCPeerConnection();
  const peerId = crypto.randomUUID();
  const create = peer.createDataChannel.bind(peer);
  peer.createDataChannel = (label, options) => {
    const channel = create(label, options);
    channel.addEventListener('message', (event) =>
      diagnosticCapture.liveWire(event.data, 'received', peerId),
    );
    const send = channel.send.bind(channel);
    channel.send = ((data: string) => {
      send(data);
      diagnosticCapture.liveWire(data, 'sent', peerId);
    }) as typeof channel.send;
    return channel;
  };
  return peer;
}
