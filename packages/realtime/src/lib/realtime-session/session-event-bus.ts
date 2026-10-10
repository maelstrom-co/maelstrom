import type {
  TimedTranscriptFragment,
  Unsubscribe,
  VoiceMediaObservation,
} from '@maelstrom-co/client';
import type { ToolCallId } from '@maelstrom-co/protocol';

/**
 * A fact one `RealtimeSession` learned or caused, in the past tense or as an
 * observation. The union has no request variants, so the bus cannot carry a
 * command. Requests that need an answer stay on their own request and
 * response paths: `tool.called` only reports that a call arrived, and the
 * answer still goes back to the provider directly. Work status is not an
 * event: it is a level owned by the Orchestrator and read through its own
 * source.
 *
 * The union is additive: later versions may add variants, so a subscriber
 * must ignore types it does not handle.
 */
export type SessionEvent =
  | SessionLifecycleEvent
  | TranscriptFragmentEvent
  | TranscriptEntryEvent
  | MediaEvent
  | ToolCallEvent
  | ToolOutcomeEvent
  | TimingEvent
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

/**
 * A whole transcript entry: a legacy adapter transcript, or the fixed greeting
 * line when its playback started. Live fragments are
 * {@link TranscriptFragmentEvent}s instead.
 */
export interface TranscriptEntryEvent {
  /** Discriminant. */
  readonly type: 'transcript.entry';
  /** Who spoke. */
  readonly role: 'user' | 'assistant';
  /** Transcript text as the adapter reported it. */
  readonly text: string;
  /** Whether the provider marked the entry as final. */
  readonly final: boolean;
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
 * Brackets every provider tool call, whatever its name. Recovery outcomes of
 * `update_ui` requests are separate {@link ToolOutcomeEvent}s published
 * between the two, and both kinds share `callId`.
 */
export type ToolCallEvent =
  | ToolCalledEvent
  | ToolResultEvent
  | ToolCancelledEvent;

/** A provider tool call arrived and is about to be dispatched. */
export interface ToolCalledEvent {
  /** Discriminant. */
  readonly type: 'tool.called';
  /** Session generation captured before subscriber callbacks. Absent in legacy events. */
  readonly generation?: number;
  /** Provider correlation identity of the call. */
  readonly callId: ToolCallId;
  /** Tool name as the provider sent it, including names the session does not know. */
  readonly name: string;
  /** Raw JSON arguments exactly as the provider sent them; may contain user speech. */
  readonly argumentsJson: string;
}

/**
 * Local handling of a tool call finished. Provider delivery is best-effort:
 * this event can follow a started, failed or skipped send; it neither waits for
 * delivery nor confirms receipt.
 * It is not published when a disconnect or reconnect starts between the call's
 * arrival and its dispatch.
 */
export interface ToolResultEvent {
  /** Discriminant. */
  readonly type: 'tool.result';
  /** Original session generation, even when handling settles after reconnect. */
  readonly generation?: number;
  /** Provider correlation identity of the call. */
  readonly callId: ToolCallId;
  /** Whether the tool succeeded; for `update_ui`, whether the change rendered. */
  readonly ok: boolean;
  /** Client-clock milliseconds from arrival until local handling finishes. */
  readonly latencyMs: number;
}

/** A call was observed but connection cancellation prevented its dispatch. */
export interface ToolCancelledEvent {
  /** Discriminant. */
  readonly type: 'tool.cancelled';
  /** Original session generation. */
  readonly generation: number;
  /** Provider correlation identity of the undispatched call. */
  readonly callId: ToolCallId;
}

/** A measured duration of `update_ui` work, such as its render or its failure. */
export interface TimingEvent {
  /** Discriminant. */
  readonly type: 'timing';
  /** What was measured, for example `update_ui.render` or `update_ui.error`. */
  readonly label: string;
  /** Client-clock duration in milliseconds. */
  readonly ms: number;
}

/**
 * Recovery outcome of one `update_ui` request. Every variant carries the
 * request's intent, so a subscriber never has to ask the session for it.
 * Outcomes carry no generation because submitted work can finish after voice
 * ends and still belongs to the same request.
 */
export type ToolOutcomeEvent = ToolSubmittedEvent | ToolLaterOutcomeEvent;

/** Admission and application outcomes; queued/refused work need not have submitted. */
export type ToolLaterOutcomeType =
  | 'tool.queued'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.unconfirmed'
  | 'tool.not_submitted';

/** An `update_ui` intent began processing, or entered a legacy immediate bridge. */
export interface ToolSubmittedEvent {
  /** Discriminant. */
  readonly type: 'tool.submitted';
  /** Local correlation identity of the request. */
  readonly callId: ToolCallId;
  /** Requested natural-language intent. */
  readonly intent: string;
  /** Legacy retry marker. Shared FIFO admission never retries and emits false. */
  readonly retry: boolean;
}

/** Admission or application evidence for an `update_ui` request. */
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

/**
 * Read-only access to one session's events. Delivery is synchronous, in
 * publish order, with no replay: a subscriber sees only events published
 * after it subscribed. A subscriber that throws is isolated from the others.
 */
export interface SessionEventSource {
  /** Delivers every later event to `handler` until the returned release is called. */
  subscribe(handler: SessionEventHandler): Unsubscribe;
}

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
export class SessionEventBus implements SessionEventSource {
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
