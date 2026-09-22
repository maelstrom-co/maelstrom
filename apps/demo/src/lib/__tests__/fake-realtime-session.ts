import type { TranscriptEntry, VoiceSessionState } from '@maelstrom-co/client';
import type {
  VoiceActivationConfig,
  VoiceActivationState,
} from '@maelstrom-co/realtime';

// Fakes the module boundary maelstrom.ts constructs against (RealtimeSession
// from @maelstrom-co/realtime) — mirrors packages/react-realtime's own
// FakeRealtimeSession (voice-orb.test.tsx, use-voice.test.tsx) so component
// tests here can drive state/transcript events without a real transport.
export class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];

  state: VoiceSessionState = 'idle';
  /** Retained test policy; normal is the default, independent of connection state. */
  activationConfig: VoiceActivationConfig;
  /** Admission label reflected by consumers; this fake does not run a trigger detector. */
  activationState: VoiceActivationState;
  lastError: unknown = undefined;
  connectCalls = 0;
  disconnectCalls = 0;
  /** Demo-boundary once-per-instance greeting emission (no coordinator logic). */
  greetingEmitted = false;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(t: TranscriptEntry) => void>();
  readonly #activationHandlers = new Set<
    (state: VoiceActivationState) => void
  >();

  /** Initialize the reflected policy without starting provider or activation work. */
  constructor(readonly options: unknown) {
    this.activationConfig = (
      options as { activation?: VoiceActivationConfig } | undefined
    )?.activation ?? { mode: 'normal' };
    this.activationState =
      this.activationConfig.mode === 'normal' ? 'disabled' : 'waiting';
    FakeRealtimeSession.instances.push(this);
  }

  /** Reflect stopped-only settings; core tests own phrase/duration validation. */
  configureActivation(config: VoiceActivationConfig): void {
    if (this.state !== 'idle' && this.state !== 'error')
      throw new Error('Stop voice to change settings.');
    this.activationConfig = config;
    this.activationState = config.mode === 'normal' ? 'disabled' : 'waiting';
    for (const handler of this.#activationHandlers)
      handler(this.activationState);
  }

  /** No-op chat completion for route tests; real-session tests cover activity ownership. */
  beginChatActivity(): () => Promise<void> {
    return async () => {};
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

  /** Keep activation observers separate; unsupported fake events never receive transcripts. */
  on(
    event:
      | 'state'
      | 'transcript'
      | 'activation_state'
      | 'greeting_state'
      | 'turn_mode',
    handler: never,
  ): () => void {
    const set =
      event === 'state'
        ? this.#stateHandlers
        : event === 'transcript'
          ? this.#transcriptHandlers
          : event === 'activation_state'
            ? this.#activationHandlers
            : undefined;
    if (!set) return () => {};
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
