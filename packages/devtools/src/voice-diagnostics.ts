/** Provider-neutral projection of optional transport facts. */
export interface TransportSnapshot {
  /** Provider session identifier when safe to expose. */ readonly sessionId?: string;
  /** Connection generation. */ readonly generation: number;
  /** Observed lifecycle state. */ readonly state: string;
  /** Reported usage, when available. */ readonly usageSeconds?: number;
  /** Final reported usage, when available. */ readonly finalUsageSeconds?: number;
  /** Reported context fraction, when available. */ readonly contextUsageRatio?: number;
  /** Provider finalization status. */ readonly finalization: string;
  /** Local playback status. */ readonly playback: string;
}

/** Keeps opaque correlation identifiers while excluding content-shaped values. */
export function diagnosticId(value: string | undefined): string | undefined {
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** Provider lifetime and connection generation for an observation. */
export interface VoiceEventIdentity {
  /** Application provider label. */
  readonly provider?: string;
  /** Unique provider lifetime identity. */
  readonly providerInstanceId?: string;
  /** Connection generation when observed. */
  readonly generation?: number;
}

/** Terminal transport facts retained without provider configuration. */
export interface RetainedLiveTransport
  extends ReturnType<typeof projectLiveTransport> {
  /** Application provider label. */
  readonly provider: 'live';
  /** Unique provider lifetime identity. */
  readonly providerInstanceId: string;
  /** Configured voice model, not a provider-confirmed claim. */
  readonly model: string;
  /** Configured managed model. */
  readonly backendModel: string;
  /** Browser receipt time in milliseconds. */
  readonly observedAt: number;
}

/** Metadata-only voice or Engine observation. */
export interface DiagnosticEntry {
  /** Unique provider lifetime identity. */
  readonly providerInstanceId?: string;
  /** Application provider label. */
  readonly provider?: string;
  /** Browser observation time. */
  readonly at: number;
  /** Metadata event category. */
  readonly kind:
    | 'tool_call'
    | 'tool_result'
    | 'engine_started'
    | 'engine_completed'
    | 'engine_error'
    | 'voice_error'
    | 'voice_state';
  /** Opaque tool or request correlation. */
  readonly id?: string;
  /** Recognized Maelstrom tool name. */
  readonly tool?: 'update_ui' | 'get_ui_state' | 'get_capabilities';
  /** Observed tool outcome. */
  readonly ok?: boolean;
  /** Producer-reported local duration. */
  readonly durationMs?: number;
  /** Connection generation when observed. */
  readonly generation?: number;
  /** Observed voice state. */
  readonly state?:
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'listening'
    | 'thinking'
    | 'speaking'
    | 'error'
    | 'disconnected'
    | 'disconnecting';
  /** Reported HTTP status, when present. */
  readonly status?: number;
}

/** Retains the latest 100 voice metadata events and 16 terminal transport summaries. */
export class VoiceDiagnostics {
  /** Whether this store may retain evidence in the current build. */
  protected readonly enabled = process.env.NODE_ENV !== 'production';
  private entries: readonly (DiagnosticEntry & { readonly entryId: string })[] =
    [];
  private transportHistory: readonly RetainedLiveTransport[] = [];
  private listeners = new Set<() => void>();
  /** Returns retained recent metadata. */
  getSnapshot = () => this.entries;
  /** Returns bounded terminal transport history. */
  getTransportHistory = () => this.transportHistory;
  /** Projects a terminal transport before retaining it. */
  retainTransport<T extends TransportSnapshot>(
    snapshot: T,
    identity: {
      providerInstanceId: string;
      model: string;
      backendModel: string;
    },
  ) {
    if (!this.enabled) return;
    if (
      snapshot.generation === 0 ||
      (snapshot.state !== 'closed' && snapshot.state !== 'error')
    )
      return;
    const providerInstanceId = diagnosticId(identity.providerInstanceId);
    if (!providerInstanceId) return;
    const previous = this.transportHistory.find(
      (entry) =>
        entry.providerInstanceId === providerInstanceId &&
        entry.generation === snapshot.generation,
    );
    if (
      previous &&
      JSON.stringify(projectLiveTransport(previous)) ===
        JSON.stringify(projectLiveTransport(snapshot))
    )
      return;
    const entry: RetainedLiveTransport = {
      ...projectLiveTransport(snapshot),
      provider: 'live',
      providerInstanceId,
      model: identity.model,
      backendModel: identity.backendModel,
      observedAt: Date.now(),
    };
    this.transportHistory = [
      ...this.transportHistory
        .filter(
          (previous) =>
            previous.providerInstanceId !== providerInstanceId ||
            previous.generation !== snapshot.generation,
        )
        .slice(-15),
      entry,
    ];
    for (const listener of this.listeners) listener();
  }
  /** Observes metadata and history changes. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Retains a projected metadata event without content. */
  record(entry: DiagnosticEntry) {
    if (!this.enabled) return;
    this.entries = [
      ...this.entries.slice(-99),
      {
        entryId: crypto.randomUUID(),
        at: entry.at,
        kind: entry.kind,
        provider: entry.provider,
        providerInstanceId: diagnosticId(entry.providerInstanceId),
        generation: entry.generation,
        state: entry.state,
        status: entry.status,
        ...(diagnosticId(entry.id) ? { id: diagnosticId(entry.id) } : {}),
        ...(entry.tool ? { tool: entry.tool } : {}),
        ...(typeof entry.ok === 'boolean' ? { ok: entry.ok } : {}),
        ...(Number.isFinite(entry.durationMs)
          ? { durationMs: entry.durationMs }
          : {}),
      },
    ];
    for (const listener of this.listeners) listener();
  }
  /** Projects lifecycle and tool events; transcript content is excluded. */
  onSessionEvent = (input: unknown, identity: VoiceEventIdentity = {}) => {
    const event = input as {
      type: string;
      generation?: number;
      name?: string;
      callId?: string;
      ok?: boolean;
      latencyMs?: number;
    };
    if (
      event.type === 'session.started' ||
      event.type === 'session.connected' ||
      event.type === 'session.disconnecting' ||
      event.type === 'session.disconnected' ||
      event.type === 'session.error'
    ) {
      this.record({
        at: Date.now(),
        kind: 'voice_state',
        provider: identity.provider,
        providerInstanceId: identity.providerInstanceId,
        generation: event.generation,
        state: CONNECTION_STATES[event.type as keyof typeof CONNECTION_STATES],
      });
    } else if (event.type === 'tool.called') {
      const tool =
        event.name === 'update_ui' ||
        event.name === 'get_ui_state' ||
        event.name === 'get_capabilities'
          ? event.name
          : undefined;
      this.record({
        at: Date.now(),
        kind: 'tool_call',
        id: event.callId,
        tool,
        ...identity,
      });
    } else if (event.type === 'tool.result') {
      const id = diagnosticId(event.callId);
      const call = id
        ? this.entries
            .slice()
            .reverse()
            .find(
              (entry) =>
                entry.kind === 'tool_call' &&
                entry.id === id &&
                entry.providerInstanceId === identity.providerInstanceId,
            )
        : undefined;
      this.record({
        at: Date.now(),
        kind: 'tool_result',
        provider: identity.provider,
        providerInstanceId: identity.providerInstanceId,
        generation: call?.generation,
        id: event.callId,
        ok: event.ok,
        durationMs: event.latencyMs,
      });
    }
  };
}

/** Projects only provider-neutral transport facts and safe correlation identity. */
export function projectLiveTransport<T extends TransportSnapshot>(snapshot: T) {
  return {
    sessionId: diagnosticId(snapshot.sessionId),
    generation: snapshot.generation,
    state: snapshot.state,
    usageSeconds: snapshot.usageSeconds,
    finalUsageSeconds: snapshot.finalUsageSeconds,
    contextUsageRatio: snapshot.contextUsageRatio,
    finalization: snapshot.finalization,
    playback: snapshot.playback,
  };
}

const CONNECTION_STATES = {
  'session.started': 'connecting',
  'session.connected': 'connected',
  'session.disconnecting': 'disconnecting',
  'session.disconnected': 'disconnected',
  'session.error': 'error',
} as const;
