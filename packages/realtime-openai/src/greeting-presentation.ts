import type { MessageId } from '@maelstrom-co/protocol';
import type { GreetingSpeechResult } from '@maelstrom-co/realtime';
import type { OpenAIBuiltInVoice } from '@maelstrom-co/realtime-protocol/openai';
import type {
  GreetingInterruption,
  GreetingInterruptionOperation,
  PreparedGreetingMicrophone,
} from './greeting-interruption.js';
import type {
  MicrophonePublicationGate,
  MicrophonePublicationLease,
} from './microphone-publication-gate.js';
import type { SynthesizeGreeting } from './openai-adapter.types.js';
import {
  raceAbortSignal,
  type WebAudioGreetingPlayer,
} from './web-audio-greeting-player.js';

interface PresentationOperation {
  readonly controller: AbortController;
  readonly lease: MicrophonePublicationLease | undefined;
  readonly interruption: GreetingInterruptionOperation | undefined;
  readonly generation: number;
  terminal: Promise<void> | undefined;
}

export interface GreetingPresentationOptions {
  readonly synthesize?: SynthesizeGreeting;
  readonly voice: OpenAIBuiltInVoice;
  readonly player: WebAudioGreetingPlayer;
  readonly gate: MicrophonePublicationGate;
  readonly channel: () => RTCDataChannel | undefined;
  readonly microphone: () => MediaStream | undefined;
  readonly generation: () => number;
  readonly debug: (
    category: 'presentation-failed' | 'interruption-failed',
  ) => void;
  readonly interruption?: GreetingInterruption;
}

/** Package-private owner of OpenAI greeting handoff, synthesis, and playback. */
export class GreetingPresentation {
  #operation: PresentationOperation | undefined;
  readonly #options: GreetingPresentationOptions;
  constructor(options: GreetingPresentationOptions) {
    this.#options = options;
  }

  get isActive(): boolean {
    return this.#operation !== undefined;
  }
  get isPublicationGated(): boolean {
    return this.#options.gate.active;
  }

  async prepareMicrophone(
    stream: MediaStream,
  ): Promise<PreparedGreetingMicrophone | undefined> {
    return this.#options.interruption?.prepareAndRemember(stream);
  }

  attachMicrophone(
    descriptor: PreparedGreetingMicrophone | undefined,
    sender: RTCRtpSender,
    generation: number,
  ): void {
    if (descriptor)
      this.#options.interruption?.commit(descriptor, sender, generation);
  }

  disconnect(): void {
    this.abort();
    void this.#options.interruption?.destroy();
  }

  activate(): void {
    try {
      if (this.#options.synthesize !== undefined)
        this.#options.player.activate();
    } catch {
      // Gesture activation is intentionally best-effort.
    }
  }

  abort(): void {
    const operation = this.#operation;
    if (!operation) return;
    operation.controller.abort();
    this.#settle(operation);
  }

  async speak(args: {
    readonly id: MessageId;
    readonly text: string;
    readonly signal: AbortSignal;
  }): Promise<GreetingSpeechResult> {
    const channel = this.#options.channel();
    const synthesize = this.#options.synthesize;
    if (
      !channel ||
      channel.readyState !== 'open' ||
      !synthesize ||
      args.signal.aborted
    )
      return 'not_started';

    const ready = await this.#options.player.ensureReady(args.signal);
    if (!ready.ok || args.signal.aborted) return 'not_started';
    const readyChannel = this.#options.channel();
    if (!readyChannel || readyChannel.readyState !== 'open')
      return 'not_started';
    try {
      readyChannel.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: args.text }],
          },
        }),
      );
    } catch {
      return 'not_started';
    }

    const previous = this.#operation;
    if (previous) {
      previous.controller.abort();
      const terminal = this.#settle(previous);
      // The disabled raw-gate path is synchronously released. Enabled owner
      // operations must finish their bridge transition before replacement.
      if (previous.interruption) await terminal;
    }
    const controller = new AbortController();
    const interruption = this.#options.interruption?.begin(() => {
      this.#options.player.stop();
    });
    const operation: PresentationOperation = {
      controller,
      lease: interruption
        ? undefined
        : this.#options.gate.acquire(
            this.#options.microphone(),
            this.#options.generation(),
          ),
      interruption,
      generation: this.#options.generation(),
      terminal: undefined,
    };
    this.#operation = operation;
    const onAbort = () => this.#abortExpected(operation);
    if (args.signal.aborted) onAbort();
    else args.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const synthesized = await raceAbortSignal(
        synthesize({
          text: args.text,
          voice: this.#options.voice,
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (synthesized.status === 'aborted' || controller.signal.aborted)
        return 'accepted';
      await this.#options.player.play(synthesized.value, controller.signal, {
        onPlaybackStart: () => {
          if (this.#operation === operation) operation.interruption?.arm();
        },
        onPlaybackEnd: () => {
          if (this.#operation === operation) operation.interruption?.disarm();
        },
      });
    } catch {
      this.#options.debug('presentation-failed');
    } finally {
      args.signal.removeEventListener('abort', onAbort);
      await this.#settle(operation);
    }
    return 'accepted';
  }

  #abortExpected(operation: PresentationOperation): void {
    if (this.#operation !== operation) return;
    operation.controller.abort();
    this.#settle(operation);
  }

  #settle(operation: PresentationOperation): Promise<void> {
    operation.terminal ??= (async () => {
      const current = this.#operation === operation;
      operation.interruption?.disarm();
      if (current) {
        this.#options.player.stop();
        // Disabled-mode Skip must restore the raw gate synchronously.
        operation.lease?.release();
        this.#operation = undefined;
      }
      await operation.interruption?.settle();
    })();
    return operation.terminal;
  }
}
