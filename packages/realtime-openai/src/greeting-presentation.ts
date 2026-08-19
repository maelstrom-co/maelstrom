import type { MessageId } from '@maelstrom-co/protocol';
import type { GreetingSpeechResult } from '@maelstrom-co/realtime';
import type { OpenAIBuiltInVoice } from '@maelstrom-co/realtime-protocol/openai';
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
  readonly lease: MicrophonePublicationLease;
  readonly generation: number;
}

export interface GreetingPresentationOptions {
  readonly synthesize?: SynthesizeGreeting;
  readonly voice: OpenAIBuiltInVoice;
  readonly player: WebAudioGreetingPlayer;
  readonly gate: MicrophonePublicationGate;
  readonly channel: () => RTCDataChannel | undefined;
  readonly microphone: () => MediaStream | undefined;
  readonly generation: () => number;
  readonly debug: (category: 'presentation-failed') => void;
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

    this.abort();
    const controller = new AbortController();
    const operation: PresentationOperation = {
      controller,
      lease: this.#options.gate.acquire(
        this.#options.microphone(),
        this.#options.generation(),
      ),
      generation: this.#options.generation(),
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
      await this.#options.player.play(synthesized.value, controller.signal);
    } catch {
      this.#options.debug('presentation-failed');
    } finally {
      args.signal.removeEventListener('abort', onAbort);
      this.#settle(operation);
    }
    return 'accepted';
  }

  #abortExpected(operation: PresentationOperation): void {
    if (this.#operation !== operation) return;
    operation.controller.abort();
    this.#settle(operation);
  }

  #settle(operation: PresentationOperation): void {
    // Lease identity, rather than a generation comparison that could strand a
    // gate during teardown, prevents stale completion from restoring a newer
    // operation. Clearing this operation remains safe after generation change.
    if (this.#operation !== operation) return;
    operation.lease.release();
    this.#operation = undefined;
    this.#options.player.stop();
  }
}
