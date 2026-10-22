import type {
  TelemetryErrorCategory,
  TelemetryOutcome,
} from '@maelstrom-co/telemetry';
import { projectDiagnosticMetadata } from '@maelstrom-co/telemetry/integration';
import type { PanelEvent } from './panel-model.js';
import { requestTerminalStatus } from './request-lifecycle.js';

export type EventOutcome = TelemetryOutcome | 'abandoned' | 'unreported';

export interface EventIssue {
  eventKey: string;
  outcome: 'failed' | 'skipped' | 'unknown';
  category?: TelemetryErrorCategory;
}
const diagnosticFailureKinds = new Set([
  'engine.planner.failed',
  'client.command.failed',
  'client.connection.failed',
]);

export function eventIssue(event: PanelEvent): EventIssue | undefined {
  const fact = projectDiagnosticMetadata(event.kind, event.metadata);
  if (
    fact?.outcome === 'failed' ||
    fact?.outcome === 'skipped' ||
    fact?.outcome === 'unknown'
  )
    return {
      eventKey: event.key,
      outcome: fact.outcome,
      category: fact.errorCategory,
    };
  if (
    event.metadata.outcome !== 'cancelled' &&
    (diagnosticFailureKinds.has(event.kind) ||
      (event.kind === 'engine.candidate.validated' &&
        event.metadata.outcome === 'failed'))
  )
    return { eventKey: event.key, outcome: 'failed' };
  return undefined;
}

export function eventOutcome(event: PanelEvent): EventOutcome {
  const fact = projectDiagnosticMetadata(event.kind, event.metadata);
  if (fact) return fact.outcome;
  const issue = eventIssue(event);
  if (
    issue &&
    (event.metadata.outcome === 'unknown' ||
      event.metadata.outcome === 'skipped')
  )
    return event.metadata.outcome;
  if (issue) return issue.outcome;
  if (
    event.kind === 'engine.candidate.validated' &&
    event.metadata.outcome === 'succeeded'
  )
    return 'succeeded';
  if (
    event.metadata.outcome === 'cancelled' &&
    diagnosticFailureKinds.has(event.kind)
  )
    return 'cancelled';
  const terminal = requestTerminalStatus(event.kind);
  return terminal === 'abandoned' || terminal === 'discarded'
    ? terminal
    : 'unreported';
}

export function matchesCategory(
  issue: EventIssue | undefined,
  category?: string,
): boolean {
  return (
    !category ||
    category === 'all' ||
    Boolean(issue && (issue.category ?? 'unreported') === category)
  );
}
