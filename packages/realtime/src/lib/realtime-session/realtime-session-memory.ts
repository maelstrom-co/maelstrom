import type { TimedTranscriptFragment } from '@maelstrom-co/client';
import type { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  SessionEventHandler,
  ToolLaterOutcomeType,
} from './session-event-bus.js';
import {
  DEFAULT_MAX_FRAGMENT_CHARS,
  isValidFragment,
} from './transcript-fragment-validation.js';

/** Evidence about a voice UI request, independent of provider delivery. */
export interface VoiceRecoveryOutcome {
  /** Local correlation only; never replayed as a provider function. */
  readonly id: ToolCallId;
  /** Bounded requested intent, not a spoken transcript. */
  readonly intent: string;
  /** Unknown does not authorize a retry. Submitted work can still finish after voice ends. */
  readonly status:
    | 'submitted'
    | 'queued'
    | 'completed'
    | 'failed'
    | 'unknown'
    | 'not_submitted';
  /** Bounded application evidence; absence does not mean success. */
  readonly summary?: string;
}

/** Bounded in-memory recovery evidence. Fragments are observations, never final turns or proof of audibility. */
export interface VoiceRecoverySnapshot {
  /** Whether a generated opening or fixed greeting was attempted, including ambiguous failures. */
  readonly introductionAttempted: boolean;
  /** Most recent eight observed fragments, with connection-local timing. */
  readonly fragments: readonly VoiceRecoveryFragment[];
  /** Most recent eight voice UI requests. Older records may be omitted, never replayed. */
  readonly outcomes: readonly VoiceRecoveryOutcome[];
}

/** A bounded excerpt of observed speech, never an invented complete turn. */
export interface VoiceRecoveryFragment {
  /** Unique local connection identity, including across provider recreation. */
  readonly connectionId: string;
  /** Provider-local fragment identity. */
  readonly id: string;
  /** Observed speaker role. */
  readonly role: 'user' | 'assistant';
  /** Exact observed text prefix, limited to 256 characters. */
  readonly text: string;
  /** Whether text was omitted from this excerpt. */
  readonly truncated: boolean;
  /** Inclusive provider timeline start, in milliseconds. */
  readonly startMs: number;
  /** Exclusive provider timeline end, in milliseconds. */
  readonly endMs: number;
}

/**
 * Retains opening proof and recovery evidence for one Maelstrom session identity.
 * Reuse this object when recreating RealtimeSession outside React. The React
 * extension owns it per Orchestrator. It stores no audio, credentials, commands,
 * or durable Engine history. Discard it when the application session ends.
 */
export class RealtimeSessionMemory {
  /** Application session identity owning all retained evidence. */
  readonly sessionId: SessionId;
  #snapshot: VoiceRecoverySnapshot = {
    introductionAttempted: false,
    fragments: [],
    outcomes: [],
  };
  readonly #listeners = new Set<() => void>();

  /** Binds this memory to one application session; sharing across identities is rejected. */
  constructor(sessionId: SessionId) {
    this.sessionId = sessionId;
  }

  /** Reads detached recovery evidence, including late application outcomes after disconnect. */
  getSnapshot = (): VoiceRecoverySnapshot => structuredClone(this.#snapshot);

  /** Observes evidence changes without connecting a provider. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** @internal Claims before any provider send; there is deliberately no reset. */
  claimIntroduction(): boolean {
    if (this.#snapshot.introductionAttempted) return false;
    this.#snapshot = { ...this.#snapshot, introductionAttempted: true };
    this.notify();
    return true;
  }

  /** @internal Records only validated observed fragments. */
  observe(fragment: TimedTranscriptFragment, connectionId: string): void {
    const fragments = this.#snapshot.fragments.filter(
      (value) =>
        value.id !== fragment.id || value.connectionId !== connectionId,
    );
    fragments.push({
      connectionId,
      id: fragment.id,
      role: fragment.role,
      startMs: fragment.startMs,
      endMs: fragment.endMs,
      text: fragment.text.slice(0, 256),
      truncated: fragment.text.length > 256,
    });
    this.#snapshot = { ...this.#snapshot, fragments: fragments.slice(-8) };
    this.notify();
  }

  /** @internal Updates existing request evidence without retaining executable work. */
  outcome(value: VoiceRecoveryOutcome): void {
    const outcomes = this.#snapshot.outcomes.filter(
      (entry) => entry.id !== value.id,
    );
    outcomes.push({
      ...value,
      intent: value.intent.slice(0, 128),
      ...(value.summary === undefined
        ? {}
        : { summary: value.summary.slice(0, 128) }),
    });
    this.#snapshot = { ...this.#snapshot, outcomes: outcomes.slice(-8) };
    this.notify();
  }

  /** @internal Finds retained evidence; an evicted record stays absent. */
  find(id: ToolCallId): VoiceRecoveryOutcome | undefined {
    return this.#snapshot.outcomes.find((entry) => entry.id === id);
  }

  private notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        /* Observers do not own application progress. */
      }
    }
  }
}

/**
 * Records one session's events into shared recovery memory. Memory outlives
 * sessions, so the owning session must release this subscription when it is
 * disposed and its outstanding application work has settled. Fragments use the
 * same validation rule as the observation store. Initial queue admission, submission, or refusal inserts an
 * outcome. Later events update only retained nonterminal evidence, so evicted
 * pending work never reappears and terminal uncertainty cannot become success.
 * The opening claim is a direct compare-and-set on memory, so `opening.claimed`
 * needs no work.
 */
export function recoveryMemorySubscriber(
  memory: RealtimeSessionMemory,
  maxFragmentChars: number = DEFAULT_MAX_FRAGMENT_CHARS,
): SessionEventHandler {
  const pending = new Set<ToolCallId>();
  return (event) => {
    if (event.type === 'transcript.fragment') {
      if (isValidFragment(event.fragment, maxFragmentChars))
        memory.observe(event.fragment, event.connectionId);
      return;
    }
    if (!('callId' in event) || !('intent' in event)) return;
    const existing = memory.find(event.callId);
    if (
      existing &&
      existing.status !== 'submitted' &&
      existing.status !== 'queued'
    )
      return;
    const first = !pending.has(event.callId);
    const terminal =
      event.type !== 'tool.queued' && event.type !== 'tool.submitted';
    if (terminal) pending.delete(event.callId);
    else pending.add(event.callId);
    if (
      !existing &&
      (!first ||
        (event.type === 'tool.submitted'
          ? event.retry
          : event.type !== 'tool.queued' &&
            event.type !== 'tool.not_submitted'))
    )
      return;
    memory.outcome({
      id: event.callId,
      intent: event.intent,
      status:
        event.type === 'tool.submitted'
          ? 'submitted'
          : RECOVERY_STATUS_BY_OUTCOME[event.type],
      ...('summary' in event && event.summary !== undefined
        ? { summary: event.summary }
        : {}),
    });
  };
}

const RECOVERY_STATUS_BY_OUTCOME: Record<
  ToolLaterOutcomeType,
  Exclude<VoiceRecoveryOutcome['status'], 'submitted'>
> = {
  'tool.queued': 'queued',
  'tool.completed': 'completed',
  'tool.failed': 'failed',
  'tool.unconfirmed': 'unknown',
  'tool.not_submitted': 'not_submitted',
};
