import type {
  TimedTranscriptFragment,
  Unsubscribe,
} from '@maelstrom-co/client';
import type {
  AdapterVoiceObservation,
  AdapterVoiceObservations,
} from './realtime-session/provider-adapter.types.js';

/** Options for {@link TranscriptObservationFeed}. */
export interface TranscriptObservationFeedOptions {
  /** Monotonic clock in milliseconds. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /**
   * How many recent utterances keep their accumulated text for later
   * revision. Older ones are forgotten; a later event for a forgotten id
   * starts that fragment again. Defaults to 256.
   */
  readonly maxTrackedUtterances?: number;
}

/**
 * An {@link AdapterVoiceObservations} feed for providers that report
 * transcript text but no media timestamps. Each fragment id names one
 * utterance: {@link append} revises that fragment in place with the text so
 * far, and {@link complete} replaces it with the provider's full text and
 * marks it final, so a final event never duplicates streamed text.
 *
 * Times are local receipt times in milliseconds since the last
 * {@link restart}. They approximate the connection's media timeline rather
 * than measure it. The feed reports no media evidence, so media stays
 * `unknown` for its consumers. Adapters remain responsible for dropping
 * callbacks from a stale connection before they reach the feed.
 */
export class TranscriptObservationFeed implements AdapterVoiceObservations {
  readonly #now: () => number;
  readonly #maxTracked: number;
  readonly #handlers = new Set<(event: AdapterVoiceObservation) => void>();
  readonly #utterances = new Map<string, TimedTranscriptFragment>();
  #origin: number;

  /** Creates an idle feed whose timeline starts now. */
  constructor(options: TranscriptObservationFeedOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#maxTracked = options.maxTrackedUtterances ?? 256;
    if (!Number.isSafeInteger(this.#maxTracked) || this.#maxTracked <= 0)
      throw new RangeError(
        'maxTrackedUtterances must be a positive safe integer',
      );
    this.#origin = this.#now();
  }

  /** Observes fragments. A throwing handler never affects other handlers or the adapter. */
  readonly subscribe = (
    handler: (event: AdapterVoiceObservation) => void,
  ): Unsubscribe => {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  };

  /** Starts a new connection timeline at zero and forgets every tracked utterance. */
  restart(): void {
    this.#origin = this.#now();
    this.#utterances.clear();
  }

  /**
   * Appends streamed text to utterance `id`, publishing the whole text so far
   * under the same id. Empty deltas and deltas after completion are ignored.
   */
  append(
    id: string,
    role: TimedTranscriptFragment['role'],
    delta: string,
  ): void {
    if (delta.length === 0) return;
    const previous = this.#utterances.get(id);
    if (previous?.final) return;
    const at = this.#elapsed();
    this.#publish({
      id,
      role,
      speakerId: role,
      text: (previous?.text ?? '') + delta,
      startMs: previous?.startMs ?? at,
      endMs: at,
    });
  }

  /**
   * Revises utterance `id` to the provider's full `text` and marks it final.
   * An utterance never seen before is published whole, unless its text is
   * empty, because an empty first report carries no evidence.
   */
  complete(
    id: string,
    role: TimedTranscriptFragment['role'],
    text: string,
  ): void {
    const previous = this.#utterances.get(id);
    if (!previous && text.length === 0) return;
    const at = this.#elapsed();
    this.#publish({
      id,
      role,
      speakerId: role,
      text,
      startMs: previous?.startMs ?? at,
      endMs: at,
      final: true,
    });
  }

  #elapsed(): number {
    return Math.max(0, this.#now() - this.#origin);
  }

  #publish(update: TimedTranscriptFragment): void {
    const fragment = Object.freeze(update);
    this.#utterances.delete(fragment.id);
    this.#utterances.set(fragment.id, fragment);
    if (this.#utterances.size > this.#maxTracked) {
      const oldest = this.#utterances.keys().next().value;
      if (oldest !== undefined) this.#utterances.delete(oldest);
    }
    for (const handler of [...this.#handlers]) {
      try {
        handler({ type: 'fragment', fragment });
      } catch {
        // Observers cannot interrupt provider event handling.
      }
    }
  }
}
