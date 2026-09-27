import type { SidechannelEvent } from '@maelstrom-co/protocol';
import type { LiveTransportSnapshot } from '@maelstrom-co/realtime-openai-live';
import type { DemoVoiceProvider } from './voice-provider';

export function diagnosticId(value: string | undefined): string | undefined {
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export interface VoiceEventIdentity {
  readonly provider?: DemoVoiceProvider;
  readonly providerInstanceId?: string;
  readonly generation?: number;
}

export interface RetainedLiveTransport
  extends ReturnType<typeof projectLiveTransport> {
  readonly provider: 'live';
  readonly providerInstanceId: string;
  readonly model: string;
  readonly backendModel: string;
  readonly observedAt: number;
}

export interface DiagnosticEntry {
  readonly providerInstanceId?: string;
  readonly provider?: DemoVoiceProvider;
  readonly at: number;
  readonly kind:
    | 'tool_call'
    | 'tool_result'
    | 'engine_started'
    | 'engine_completed'
    | 'engine_error'
    | 'voice_error'
    | 'voice_state';
  readonly id?: string;
  readonly tool?: 'update_ui' | 'get_ui_state' | 'get_capabilities';
  readonly ok?: boolean;
  readonly durationMs?: number;
  readonly generation?: number;
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
  readonly status?: number;
}

export class VoiceDiagnostics {
  private entries: readonly (DiagnosticEntry & { readonly entryId: string })[] =
    [];
  private transportHistory: readonly RetainedLiveTransport[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.entries;
  getTransportHistory = () => this.transportHistory;
  retainTransport(
    snapshot: LiveTransportSnapshot,
    identity: {
      providerInstanceId: string;
      model: string;
      backendModel: string;
    },
  ) {
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
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  record(entry: DiagnosticEntry) {
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
  onEvent = (event: SidechannelEvent, identity: VoiceEventIdentity = {}) => {
    if (event.type === 'tool_call') {
      const tool =
        event.name === 'update_ui' ||
        event.name === 'get_ui_state' ||
        event.name === 'get_capabilities'
          ? event.name
          : undefined;
      this.record({
        at: event.at,
        kind: event.type,
        id: event.callId,
        tool,
        ...identity,
      });
    } else if (event.type === 'tool_result') {
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
        at: event.at,
        kind: event.type,
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

export function projectLiveTransport(snapshot: LiveTransportSnapshot) {
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
