import type {
  TelemetryFact,
  TelemetryOutcome,
  TelemetryProvider,
} from './types.js';

const terminalOperations = {
  'client.action.completed': 'client.action',
  'engine.planner.completed': 'engine.plan',
  'engine.stage.completed': 'engine.stage',
  'voice.tool.result': 'voice.tool',
} as const;

function duration(
  metadata: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = metadata.durationMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function terminal(
  value: unknown,
): 'succeeded' | 'failed' | 'skipped' | undefined {
  return value === 'succeeded' || value === 'failed' || value === 'skipped'
    ? value
    : undefined;
}

function applicationOutcome(
  metadata: Readonly<Record<string, unknown>>,
): TelemetryOutcome {
  const failures = metadata.actionFailures;
  const skipped = metadata.skippedActions;
  if (
    typeof failures !== 'number' ||
    !Number.isSafeInteger(failures) ||
    failures < 0 ||
    typeof skipped !== 'number' ||
    !Number.isSafeInteger(skipped) ||
    skipped < 0
  )
    return 'unknown';
  return failures > 0 || skipped > 0 ? 'succeeded_with_issues' : 'succeeded';
}

/**
 * Projects an explicit allowlist of existing producer metadata to the operational contract.
 * Pass only kind and metadata: this API accepts no diagnostic envelope, content reader,
 * identifiers, timestamps, or raw provider frames. Unknown kinds return undefined.
 * Provider category comes from application configuration, never a free-text diagnostic label.
 * Missing or invalid durations remain unknown. This function does not subscribe to sources.
 */
export function projectDiagnosticMetadata(
  kind: string,
  metadata: Readonly<Record<string, unknown>>,
  provider?: TelemetryProvider,
): TelemetryFact | undefined {
  try {
    let operation: TelemetryFact['operation'];
    let outcome: TelemetryOutcome;
    let timed = false;
    switch (kind) {
      case 'client.request.started':
        operation = 'client.request';
        outcome = 'started';
        break;
      case 'client.response.received':
        if (metadata.source !== 'request') return undefined;
        operation = 'client.request';
        outcome = 'succeeded';
        timed = true;
        break;
      case 'client.request.failed':
        operation = 'client.request';
        outcome = 'failed';
        timed = true;
        break;
      case 'client.response.applied':
        operation = 'client.apply';
        outcome = applicationOutcome(metadata);
        break;
      case 'client.response.failed':
        operation = 'client.apply';
        outcome = 'failed';
        break;
      case 'client.response.discarded':
        operation = 'client.apply';
        outcome = 'discarded';
        break;
      case 'client.action.completed': {
        const result = terminal(metadata.outcome);
        operation = 'client.action';
        outcome = result ?? 'unknown';
        timed = true;
        break;
      }
      case 'engine.planner.started':
        operation = 'engine.plan';
        outcome = 'started';
        break;
      case 'engine.planner.completed':
      case 'engine.stage.completed': {
        const result = terminal(metadata.outcome);
        operation =
          kind === 'engine.planner.completed' ? 'engine.plan' : 'engine.stage';
        outcome = result ?? 'unknown';
        timed = true;
        break;
      }
      case 'engine.stage.started':
        operation = 'engine.stage';
        outcome = 'started';
        break;
      case 'engine.stage.failed':
        operation = 'engine.stage';
        outcome = 'failed';
        timed = true;
        break;
      case 'voice.tool.called':
        operation = 'voice.tool';
        outcome = 'started';
        break;
      case 'voice.tool.result':
        operation = 'voice.tool';
        outcome =
          typeof metadata.ok === 'boolean'
            ? metadata.ok
              ? 'succeeded'
              : 'failed'
            : 'unknown';
        timed = true;
        break;
      case 'voice.tool.cancelled':
        operation = 'voice.tool';
        outcome = 'cancelled';
        break;
      default:
        return undefined;
    }
    const durationMs = timed ? duration(metadata) : undefined;
    return {
      operation,
      outcome,
      ...(provider === undefined ? {} : { provider }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  } catch {
    if (!Object.hasOwn(terminalOperations, kind)) return undefined;
    return {
      operation: terminalOperations[kind as keyof typeof terminalOperations],
      outcome: 'unknown',
      ...(provider === undefined ? {} : { provider }),
    };
  }
}
