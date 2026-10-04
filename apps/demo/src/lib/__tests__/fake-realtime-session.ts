import type {
  TranscriptEntry,
  VoiceCaption,
  VoiceObservationSnapshot,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { SessionEvent } from '@maelstrom-co/realtime';

export const EMPTY_VOICE_OBSERVATIONS: VoiceObservationSnapshot = {
  generation: 0,
  connection: 'disconnected',
  media: {
    microphone: 'unknown',
    userSpeech: 'unknown',
    incomingAudio: 'unknown',
  },
  applicationWork: { planning: 'inactive', applying: 'inactive' },
  fragments: [],
  captions: [],
};

// Fakes the module boundary maelstrom.ts constructs against (RealtimeSession
// from @maelstrom-co/realtime) — mirrors packages/react-realtime's own
// FakeRealtimeSession (voice-orb.test.tsx, use-voice.test.tsx) so component
// tests here can drive state/transcript events without a real transport.
export class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  private observationSnapshot = EMPTY_VOICE_OBSERVATIONS;
  private observationHandlers = new Set<() => void>();
  private captionCount = 0;
  observations = {
    getSnapshot: () => this.observationSnapshot,
    subscribe: (handler: () => void) => {
      this.observationHandlers.add(handler);
      return () => {
        this.observationHandlers.delete(handler);
      };
    },
  };
  private eventHandlers = new Set<(event: SessionEvent) => void>();
  events = {
    subscribe: (handler: (event: SessionEvent) => void) => {
      this.eventHandlers.add(handler);
      return () => {
        this.eventHandlers.delete(handler);
      };
    },
  };
  emitObservations(snapshot: VoiceObservationSnapshot) {
    this.observationSnapshot = snapshot;
    for (const handler of this.observationHandlers) handler();
  }
  /**
   * Publishes one caption the way the observation store groups fragments: a
   * speaker's open caption is revised in place, and a final one is followed by
   * a new caption with a new ID.
   */
  emitCaption(entry: TranscriptEntry): void {
    const captions = [...this.observationSnapshot.captions];
    const latest = captions
      .filter((caption) => caption.role === entry.role)
      .at(-1);
    const index = latest ? captions.indexOf(latest) : -1;
    const open = latest !== undefined && !latest.final;
    const id = open
      ? latest.id
      : `caption-${entry.role}-${++this.captionCount}`;
    const caption: VoiceCaption = {
      id,
      role: entry.role,
      speakerId: entry.role,
      fragmentIds: [id],
      text: entry.text,
      startMs: 0,
      endMs: 0,
      final: entry.final,
    };
    if (open) captions[index] = caption;
    else captions.push(caption);
    this.emitObservations({ ...this.observationSnapshot, captions });
  }
  lastError: unknown = undefined;
  connectCalls = 0;
  disconnectCalls = 0;
  /** Demo-boundary once-per-instance greeting emission (no coordinator logic). */
  greetingEmitted = false;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(t: TranscriptEntry) => void>();

  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.emitState('connected');
  }

  /**
   * Emit the configured greeting as one final assistant transcript and one
   * final assistant caption, the way an adapter observes it at playback start,
   * once per instance. No-op when unconfigured or already emitted. Does not
   * auto-fire from `connect()`, which keeps existing tests deterministic.
   */
  emitGreeting(): void {
    const greeting = (
      this.options as { greeting?: { text?: string } } | undefined
    )?.greeting?.text;
    if (this.greetingEmitted || !greeting) return;
    this.greetingEmitted = true;
    const entry = { role: 'assistant', text: greeting, final: true } as const;
    this.emitTranscript(entry);
    this.emitCaption(entry);
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.emitState('idle');
  }

  on(event: 'state' | 'transcript', handler: never): () => void {
    const set =
      event === 'state' ? this.#stateHandlers : this.#transcriptHandlers;
    set.add(handler);
    return () => set.delete(handler);
  }

  getAudioStreams() {
    return {};
  }

  emitState(next: VoiceSessionState): void {
    this.state = next;
    for (const handler of this.#stateHandlers) handler(next);
  }

  emitTranscript(entry: TranscriptEntry): void {
    for (const handler of this.#transcriptHandlers) handler(entry);
  }
}
