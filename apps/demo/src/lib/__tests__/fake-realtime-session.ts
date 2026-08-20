import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';

// Fakes the module boundary maelstrom.ts constructs against (RealtimeSession
// from @maelstrom-co/realtime) — mirrors packages/react-realtime's own
// FakeRealtimeSession (voice-orb.test.tsx, use-voice.test.tsx) so component
// tests here can drive state/transcript events without a real transport.
export class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
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
   * Emit the configured greeting as one final assistant transcript, once per
   * instance. No-op when unconfigured or already emitted. Does not auto-fire
   * from `connect()` — keeps existing tests deterministic.
   */
  emitGreeting(): void {
    const greeting = (
      this.options as { greeting?: { text?: string } } | undefined
    )?.greeting?.text;
    if (this.greetingEmitted || !greeting) return;
    this.greetingEmitted = true;
    this.emitTranscript({ role: 'assistant', text: greeting, final: true });
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
