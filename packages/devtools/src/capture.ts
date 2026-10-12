import type { VoiceObservationSnapshot } from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { sanitizeDiagnosticValue } from '@maelstrom-co/protocol';

type Fields = Record<string, unknown>;
const MAX_EVENTS = 1000;
/** Bounds and application-specific projections for explicit content capture. */
export interface CaptureOptions {
  /** Maximum retained events. Defaults to 1000. */
  readonly maxEvents?: number;
  /** Maximum serialized event characters. Defaults to 2000000. */
  readonly maxCharacters?: number;
  /** Maximum characters in one string. Defaults to 16384. */
  readonly maxStringCharacters?: number;
  /** Additional application redaction, applied before retention and export. */
  readonly redact?: (value: unknown) => unknown;
  /** Application-owned model/configuration provenance. */
  readonly metadata?: (mode: string) => Record<string, unknown>;
}

const MAX_CHARACTERS = 2_000_000;

function object(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Bounded explicit capture. No content is retained before start. */
export class DiagnosticCapture {
  /** Whether this capture may retain evidence in the current build. */
  protected readonly enabled = process.env.NODE_ENV !== 'production';
  private listeners = new Set<() => void>();
  private readonly redactors = new Set<(value: unknown) => unknown>();
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
  private evidenceRevision = 0;
  /** Returns retained capture status. */
  getSnapshot = () => this.state;
  /** Returns a revision for capture evidence changes, including redaction. Note edits update status separately. */
  getEvidenceRevision = (): number => this.evidenceRevision;
  /** Observes changes until unsubscribed. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Creates an inactive capture with optional redaction and bounds. */
  constructor(
    private readonly getKey: () => string | null = () => null,
    private readonly options: CaptureOptions = {},
  ) {
    for (const [name, value] of Object.entries(this.getLimits()))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError(`${name} must be a positive integer.`);
  }
  /** Returns the configured event, serialized-character, and string limits. */
  getLimits(): Required<
    Pick<CaptureOptions, 'maxEvents' | 'maxCharacters' | 'maxStringCharacters'>
  > {
    return {
      maxEvents: this.options.maxEvents ?? MAX_EVENTS,
      maxCharacters: this.options.maxCharacters ?? MAX_CHARACTERS,
      maxStringCharacters: this.options.maxStringCharacters ?? 16384,
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Continue notifying independent observers. */
      }
    }
  }

  /** Starts a new capture and clears earlier evidence. Omit identities to capture all Provider lifetimes. */
  start(mode: string, sessionId?: string, providerInstanceId?: string) {
    if (!this.enabled) return;
    this.clear();
    this.startedAt = Date.now();
    this.startedMono = performance.now();
    this.metadata = this.clean({
      mode,
      scope: sessionId === undefined ? 'all-providers' : 'provider',
      sessionId,
      providerInstanceId,
      startedAt: new Date(this.startedAt).toISOString(),
      localDate: new Date(this.startedAt).toLocaleDateString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...this.options.metadata?.(mode),
    }) as Fields;
    this.state = { active: true, count: 0, dropped: 0, outcome: '', mode };
    this.record('capture_started', { mode });
  }

  /** Stops recording and retains the evidence. */
  stop() {
    if (!this.state.active) return;
    this.record('capture_stopped', {});
    this.state = { ...this.state, active: false };
    this.fragments.clear();
    this.notify();
  }

  /** Clears retained evidence and notes. */
  clear() {
    this.evidenceRevision++;
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
    const options = {
      secrets: key ? [key] : [],
      maxCharacters: this.options.maxCharacters,
      maxStringCharacters: this.options.maxStringCharacters,
    };
    let result = sanitizeDiagnosticValue(value, options);
    for (const redact of [this.options.redact, ...this.redactors])
      if (redact)
        result = sanitizeDiagnosticValue(result, { ...options, redact });
    return result;
  }
  /** Composes an application policy into an existing store, including retained evidence. Policies should be idempotent. */
  addRedactor(redact: (value: unknown) => unknown): () => void {
    this.evidenceRevision++;
    this.redactors.add(redact);
    try {
      const entries = this.entries;
      this.entries = [];
      this.characters = 0;
      let dropped = this.state.dropped;
      for (const entry of entries) {
        const cleaned = this.clean(entry) as Fields;
        const size = JSON.stringify(cleaned).length;
        if (this.characters + size > this.getLimits().maxCharacters) {
          dropped++;
          continue;
        }
        this.entries.push(cleaned);
        this.characters += size;
      }
      this.metadata = this.clean(this.metadata) as Fields;
      this.state = {
        ...this.state,
        count: this.entries.length,
        dropped,
        outcome: String(this.clean(this.state.outcome)),
      };
      for (const [id, value] of this.fragments)
        this.fragments.set(id, JSON.stringify(this.clean(JSON.parse(value))));
    } catch {
      this.clear();
    }
    this.notify();
    return () => {
      this.redactors.delete(redact);
    };
  }

  /** Records one event only during an explicit capture. */
  record(kind: string, fields: Fields) {
    if (!this.enabled || !this.state.active) return;
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
        this.entries.length >= (this.options.maxEvents ?? MAX_EVENTS) ||
        this.characters + size > (this.options.maxCharacters ?? MAX_CHARACTERS)
      ) {
        this.state = { ...this.state, dropped: this.state.dropped + 1 };
      } else {
        this.characters += size;
        this.entries.push(entry);
        this.state = { ...this.state, count: this.entries.length };
      }
      this.evidenceRevision++;
      this.notify();
    } catch {
      // Capture must not change application or provider behavior.
    }
  }

  /** Projects supported voice events without retaining raw provider frames. */
  sessionEvent(input: unknown, identity: Fields) {
    if (!this.state.active) return;
    const event = object(input);
    if (event.type === 'tool.called') {
      let intent: string | undefined;
      try {
        intent = text(object(JSON.parse(String(event.argumentsJson))).intent);
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

  /** Records observation changes and post-start transcript revisions. */
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
      const value = JSON.stringify(this.clean(fragment));
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

  /** Records request identity and update reasons. */
  engineRequest(message: ChartRequestMessage) {
    this.record('engine_request', {
      requestId: message.id,
      sessionId: message.sessionId,
      reasons: message.request.context.updateReasons,
    });
  }

  /** Records a correlated Engine response. */
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

  /** Retains a redacted note, limited to 4000 characters. */
  setOutcome(outcome: string) {
    if (!this.enabled) return;
    this.state = {
      ...this.state,
      outcome: String(this.clean(outcome.slice(0, 4000))),
    };
    this.notify();
  }

  /** Serializes retained evidence using capture schema version 1. */
  export(outcome = this.state.outcome) {
    if (!this.enabled) return '';
    return JSON.stringify(
      {
        schemaVersion: 1,
        metadata: this.clean(this.metadata),
        outcome: this.clean(outcome),
        active: this.state.active,
        droppedEvents: this.state.dropped,
        limits: {
          events: this.options.maxEvents ?? MAX_EVENTS,
          characters: this.options.maxCharacters ?? MAX_CHARACTERS,
          stringCharacters: this.options.maxStringCharacters ?? 16384,
        },
        limitations: [
          'Browser and server clocks are independent. Receipt is not proof of render or audibility.',
          'Only evidence exposed by attached libraries is recorded.',
          'Provider and application identities are not inferred.',
        ],
        events: this.entries.map((entry) => this.clean(entry)),
      },
      null,
      2,
    );
  }
}
