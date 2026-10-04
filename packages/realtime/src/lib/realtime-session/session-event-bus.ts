import type {
  TimedTranscriptFragment,
  Unsubscribe,
  VoiceMediaObservation,
} from '@maelstrom-co/client';
import type { ToolCallId } from '@maelstrom-co/protocol';

/**
 * A fact one `RealtimeSession` learned or caused, in the past tense.
 * The union is closed and has no request variants, so the bus cannot carry a
 * command. Requests that need an answer (tool calls, the opening claim) stay
 * on their own request and response paths. Work status is not an event: it
 * is a level owned by the Orchestrator and read through its own source.
 */
export type SessionEvent =
  | SessionLifecycleEvent
  | TranscriptFragmentEvent
  | MediaEvent
  | ToolOutcomeEvent
  | OpeningClaimedEvent;

/** Connection lifecycle facts. Only the session knows them. */
export type SessionLifecycleEvent =
  | SessionStartedEvent
  | {
      /** The provider connection of this generation is established. */
      readonly type: 'session.connected';
      /** Connection generation the fact belongs to. */
      readonly generation: number;
    }
  | {
      /** Local teardown of this generation began. */
      readonly type: 'session.disconnecting';
      /** Connection generation the fact belongs to. */
      readonly generation: number;
    }
  | {
      /** The session is dormant after teardown. */
      readonly type: 'session.disconnected';
      /** Connection generation the fact belongs to. */
      readonly generation: number;
    }
  | {
      /** The connection of this generation failed. */
      readonly type: 'session.error';
      /** Connection generation the fact belongs to. */
      readonly generation: number;
    };

/** A new connection attempt started and opened a new generation. */
export interface SessionStartedEvent {
  /** Discriminant. */
  readonly type: 'session.started';
  /** One-based count of connection attempts made by this session. */
  readonly generation: number;
  /** Unique local identity of this connection attempt. */
  readonly connectionId: string;
}

/** Adapter transcript evidence, relayed only after the session fenced stale connections. */
export interface TranscriptFragmentEvent {
  /** Discriminant. */
  readonly type: 'transcript.fragment';
  /** Connection generation the fragment was observed in. */
  readonly generation: number;
  /** Local identity of the connection the fragment was observed on. */
  readonly connectionId: string;
  /** The fragment exactly as the adapter reported it, not yet validated. */
  readonly fragment: TimedTranscriptFragment;
}

/** Adapter media evidence, relayed only after the session fenced stale connections. */
export interface MediaEvent {
  /** Discriminant. */
  readonly type: 'media';
  /** Connection generation the evidence belongs to. */
  readonly generation: number;
  /** Changed media fields only; absent fields keep their previous value. */
  readonly media: Partial<VoiceMediaObservation>;
}

/**
 * Recovery outcome of one `update_ui` request. Every variant carries the
 * request's intent, so a subscriber never has to ask the session for it.
 * Outcomes carry no generation because submitted work can finish after voice
 * ends and still belongs to the same request.
 */
export type ToolOutcomeEvent = ToolSubmittedEvent | ToolLaterOutcomeEvent;

/** Outcomes that can follow a request's first submission. */
export type ToolLaterOutcomeType =
  | 'tool.queued'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.unconfirmed'
  | 'tool.not_submitted';

/** An `update_ui` intent was handed to the application. */
export interface ToolSubmittedEvent {
  /** Discriminant. */
  readonly type: 'tool.submitted';
  /** Local correlation identity of the request. */
  readonly callId: ToolCallId;
  /** Requested natural-language intent. */
  readonly intent: string;
  /** True when a queued request was submitted again, rather than first received. */
  readonly retry: boolean;
}

/** A later outcome of an `update_ui` request that was already submitted once. */
export interface ToolLaterOutcomeEvent {
  /** Discriminant. `tool.unconfirmed` means the application result is unknown. */
  readonly type: ToolLaterOutcomeType;
  /** Local correlation identity of the request. */
  readonly callId: ToolCallId;
  /** Requested natural-language intent. */
  readonly intent: string;
  /** Bounded application evidence; absence does not mean success. */
  readonly summary?: string;
}

/** The session won the once-per-memory opening claim and may request an opening. */
export interface OpeningClaimedEvent {
  /** Discriminant. */
  readonly type: 'opening.claimed';
}

/** Receives every published event, in publish order. */
export type SessionEventHandler = (event: SessionEvent) => void;

/** Reports a subscriber that threw while handling an event. */
export type SessionEventErrorReporter = (
  error: unknown,
  event: SessionEvent,
) => void;

/**
 * Package-private fan-out of session facts to independent subscribers.
 *
 * Delivery is one FIFO queue drained synchronously by a single loop, so every
 * subscriber sees one global order and all subscribers are up to date when
 * the outermost `publish` returns. A publish from inside a handler is queued
 * behind the event being delivered instead of being delivered depth-first.
 * Each subscriber's failure is caught and reported separately.
 */
export class SessionEventBus {
  readonly #subscribers = new Set<SessionEventHandler>();
  readonly #queue: SessionEvent[] = [];
  readonly #reportError: SessionEventErrorReporter;
  #draining = false;

  /** Creates an empty bus that reports subscriber failures to `reportError`. */
  constructor(reportError: SessionEventErrorReporter) {
    this.#reportError = reportError;
  }

  /**
   * Delivers every later event to `handler`. There is no replay of earlier
   * events. The returned release is idempotent and also stops delivery of
   * events that were queued but not yet delivered.
   */
  subscribe(handler: SessionEventHandler): Unsubscribe {
    const subscriber: SessionEventHandler = (event) => handler(event);
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /** Queues `event` and drains the queue unless a drain is already running. */
  publish(event: SessionEvent): void {
    this.#queue.push(event);
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (
        let next = this.#queue.shift();
        next !== undefined;
        next = this.#queue.shift()
      )
        this.#deliver(next);
    } finally {
      this.#draining = false;
    }
  }

  #deliver(event: SessionEvent): void {
    for (const subscriber of [...this.#subscribers]) {
      if (!this.#subscribers.has(subscriber)) continue;
      try {
        subscriber(event);
      } catch (error) {
        try {
          this.#reportError(error, event);
        } catch {
          // A failing reporter must not stop delivery to later subscribers.
        }
      }
    }
  }
}
