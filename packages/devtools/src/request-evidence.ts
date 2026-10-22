import { projectDiagnosticMetadata } from '@maelstrom-co/telemetry/integration';
import { identity, identityAvailability } from './diagnostic-identity.js';
import type { RequestStatus, RequestTrace } from './panel-model.js';
import { requestTerminalStatus, responseSource } from './request-lifecycle.js';

export type RequestOutcome = RequestStatus | 'unknown' | 'ambiguous';
export type RequestTimingEvidence =
  | { kind: 'reported'; durationMs: number }
  | {
      kind: 'unreported';
      reason:
        | 'missing'
        | 'redacted'
        | 'truncated'
        | 'unreadable'
        | 'source-unavailable'
        | 'push'
        | 'ambiguous';
    };
function timing(
  metadata: Readonly<Record<string, unknown>>,
  durationMs: number | undefined,
): RequestTimingEvidence {
  if (durationMs !== undefined) return { kind: 'reported', durationMs };
  const availability = identityAvailability(metadata.durationMs);
  return {
    kind: 'unreported',
    reason:
      availability === 'not-reported'
        ? 'missing'
        : availability === 'reported'
          ? 'unreadable'
          : availability,
  };
}

export function requestEvidence(request: RequestTrace) {
  const seen = new Set<object>();
  const sessions = new Set<string>();
  const sources = new Set<'request' | 'push'>();
  let starts = 0,
    receipts = 0,
    ends = 0,
    ambiguous = false;
  let roundTrip: RequestTimingEvidence = {
    kind: 'unreported',
    reason: 'missing',
  };
  let application: RequestTimingEvidence = {
    kind: 'unreported',
    reason: 'missing',
  };
  let outcome: RequestOutcome = request.status;
  for (const event of request.events) {
    if (seen.has(event.raw)) continue;
    seen.add(event.raw);
    const session = identity(event.raw.sessionId);
    if (session) sessions.add(session);
    const source = responseSource(event.kind, event.metadata.source);
    if (source) sources.add(source);
    if (event.kind === 'client.request.started') {
      sources.add('request');
      ambiguous ||= starts > 0 || receipts > 0 || ends > 0;
      starts++;
    }
    if (event.kind === 'client.response.received') {
      ambiguous ||= receipts > 0 || ends > 0;
      receipts++;
    }
    if (requestTerminalStatus(event.kind)) {
      ambiguous ||=
        ends > 0 || (event.kind === 'client.request.failed' && receipts > 0);
      ends++;
    }
    const fact = projectDiagnosticMetadata(event.kind, event.metadata);
    if (event.kind === 'client.response.received' && !fact)
      roundTrip = { kind: 'unreported', reason: 'source-unavailable' };
    if (
      fact?.operation === 'client.request' &&
      event.kind !== 'client.request.started'
    )
      roundTrip = timing(event.metadata, fact.durationMs);
    if (
      fact?.operation === 'client.apply' &&
      (event.kind === 'client.response.applied' ||
        event.kind === 'client.response.failed')
    )
      application = timing(event.metadata, fact.durationMs);
    if (
      (event.kind === 'client.response.applied' ||
        event.kind === 'client.request.failed') &&
      fact?.outcome === 'unknown'
    )
      outcome = 'unknown';
  }
  ambiguous ||= sessions.size > 1 || sources.size > 1;
  if (ambiguous)
    return {
      outcome: 'ambiguous' as const,
      roundTrip: { kind: 'unreported', reason: 'ambiguous' } as const,
      application: { kind: 'unreported', reason: 'ambiguous' } as const,
    };
  if (
    outcome === 'unknown' &&
    (request.status === 'applied' ||
      request.status === 'applied-with-issues') &&
    (request.observedFailedActions > 0 ||
      request.observedSkippedActions > 0 ||
      [request.failedActions, request.skippedActions].some(
        (count) =>
          count !== undefined && Number.isSafeInteger(count) && count > 0,
      ))
  )
    outcome = 'applied-with-issues';
  if (request.push) roundTrip = { kind: 'unreported', reason: 'push' };
  return { outcome, roundTrip, application };
}
