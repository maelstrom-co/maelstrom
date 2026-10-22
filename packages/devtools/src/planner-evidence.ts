import {
  type IdentityAvailability,
  identityAvailability,
} from './diagnostic-identity.js';
import { type EventOutcome, eventOutcome } from './event-outcome.js';
import type { RequestTrace } from './panel-model.js';
import { requestEvidence } from './request-evidence.js';

export type PlannerFact<T> =
  | { kind: 'reported'; value: T }
  | {
      kind: 'unreported';
      reason: Exclude<IdentityAvailability, 'reported'>;
    };

export type PlannerObservation =
  | {
      kind: 'planning';
      eventKey: string;
      phase: 'started' | 'completed' | 'failed';
      outcome: PlannerFact<EventOutcome>;
      durationMs: PlannerFact<number>;
    }
  | { kind: 'attempt'; eventKey: string; attempt: PlannerFact<number> }
  | {
      kind: 'validation';
      eventKey: string;
      outcome: PlannerFact<'succeeded' | 'failed'>;
    }
  | {
      kind: 'call';
      eventKey: string;
      source: 'llm' | 'jev';
      model: PlannerFact<string>;
      stage: PlannerFact<string>;
      outcome: PlannerFact<string>;
      durationMs: PlannerFact<number>;
      inputTokens: PlannerFact<number>;
      outputTokens: PlannerFact<number>;
    };

const llmOutcomes = new Set(['ok', 'error', 'cancelled']);
const jevOutcomes = new Set([
  'ok',
  'cancelled',
  'option_cap',
  'provider_timeout',
  'provider_network',
  'provider_http',
  'provider_invalid_reply',
  'provider_refusal',
  'transport_error',
]);

function fact<T>(
  value: unknown,
  accepts: (value: unknown) => value is T,
): PlannerFact<T> {
  if (accepts(value)) return { kind: 'reported', value };
  const availability = identityAvailability(value);
  return {
    kind: 'unreported',
    reason: availability === 'reported' ? 'unreadable' : availability,
  };
}

function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function reportedText(value: unknown): value is string {
  return (
    typeof value === 'string' && identityAvailability(value) === 'reported'
  );
}

function elapsed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function plannerEvidence(request: RequestTrace): PlannerObservation[] {
  if (requestEvidence(request).outcome === 'ambiguous') return [];
  const observations: PlannerObservation[] = [];
  for (const event of request.events) {
    if (
      event.kind === 'engine.planner.started' ||
      event.kind === 'engine.planner.completed' ||
      event.kind === 'engine.planner.failed'
    )
      observations.push({
        kind: 'planning',
        eventKey: event.key,
        phase:
          event.kind === 'engine.planner.started'
            ? 'started'
            : event.kind === 'engine.planner.completed'
              ? 'completed'
              : 'failed',
        outcome:
          event.kind === 'engine.planner.started'
            ? { kind: 'reported', value: 'started' }
            : fact(
                event.metadata.outcome,
                (value): value is EventOutcome =>
                  typeof value === 'string' && value === eventOutcome(event),
              ),
        durationMs: fact(event.metadata.durationMs, elapsed),
      });
    if (event.kind === 'engine.planner.attempt')
      observations.push({
        kind: 'attempt',
        eventKey: event.key,
        attempt: fact(event.metadata['maelstrom.attempt'], counter),
      });
    if (event.kind === 'engine.llm.call' || event.kind === 'engine.jev.call') {
      const source = event.kind === 'engine.llm.call' ? 'llm' : 'jev';
      observations.push({
        kind: 'call',
        eventKey: event.key,
        source,
        model: fact(event.metadata['gen_ai.request.model'], reportedText),
        stage: fact(event.metadata['maelstrom.stage'], reportedText),
        outcome: fact(
          event.metadata['maelstrom.outcome'],
          (value): value is string =>
            typeof value === 'string' &&
            (source === 'llm' ? llmOutcomes : jevOutcomes).has(value),
        ),
        durationMs: fact(event.metadata['maelstrom.latency_ms'], elapsed),
        inputTokens: fact(event.metadata['gen_ai.usage.input_tokens'], counter),
        outputTokens: fact(
          event.metadata['gen_ai.usage.output_tokens'],
          counter,
        ),
      });
    }
    if (event.kind === 'engine.candidate.validated')
      observations.push({
        kind: 'validation',
        eventKey: event.key,
        outcome: fact(
          event.metadata.outcome,
          (value): value is 'succeeded' | 'failed' =>
            value === 'succeeded' || value === 'failed',
        ),
      });
  }
  return observations;
}
