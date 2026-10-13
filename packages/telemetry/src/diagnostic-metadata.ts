import { operationalKinds } from './operational-kinds.js';
import type {
  TelemetryErrorCategory,
  TelemetryFact,
  TelemetryOutcome,
  TelemetryProvider,
} from './types.js';

import { telemetryErrorCategories } from './vocabulary.js';

const terminalOperations = {
  [operationalKinds.clientActionCompleted]: 'client.action',
  [operationalKinds.engineRequestCompleted]: 'engine.request',
  [operationalKinds.enginePlannerCompleted]: 'engine.plan',
  [operationalKinds.engineStageCompleted]: 'engine.stage',
  [operationalKinds.voiceToolResult]: 'voice.tool',
} as const;

function duration(
  metadata: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = metadata.durationMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function terminal(value: unknown): TelemetryOutcome | undefined {
  return value === 'succeeded' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'cancelled' ||
    value === 'unknown'
    ? value
    : undefined;
}

function errorCategory(value: unknown): TelemetryErrorCategory | undefined {
  return telemetryErrorCategories.find((category) => category === value);
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
      case operationalKinds.voiceTelemetryDropped:
        operation = 'telemetry.source';
        outcome = 'discarded';
        break;
      case operationalKinds.clientRequestStarted:
        operation = 'client.request';
        outcome = 'started';
        break;
      case operationalKinds.clientResponseReceived:
        if (metadata.source !== 'request') return undefined;
        operation = 'client.request';
        outcome = 'succeeded';
        timed = true;
        break;
      case operationalKinds.clientRequestFailed:
        operation = 'client.request';
        outcome = terminal(metadata.outcome) ?? 'failed';
        timed = true;
        break;
      case operationalKinds.clientResponseApplied:
        operation = 'client.apply';
        outcome = applicationOutcome(metadata);
        timed = true;
        break;
      case operationalKinds.clientResponseFailed:
        operation = 'client.apply';
        outcome = 'failed';
        timed = true;
        break;
      case operationalKinds.clientResponseDiscarded:
        operation = 'client.apply';
        outcome = 'discarded';
        break;
      case operationalKinds.clientActionCompleted: {
        const result = terminal(metadata.outcome);
        operation = 'client.action';
        outcome = result ?? 'unknown';
        timed = true;
        break;
      }
      case operationalKinds.engineRequestStarted:
        operation = 'engine.request';
        outcome = 'started';
        break;
      case operationalKinds.enginePlannerStarted:
        operation = 'engine.plan';
        outcome = 'started';
        break;
      case operationalKinds.engineRequestCompleted:
      case operationalKinds.enginePlannerCompleted:
      case operationalKinds.engineStageCompleted: {
        const result = terminal(metadata.outcome);
        operation =
          kind === operationalKinds.engineRequestCompleted
            ? 'engine.request'
            : kind === operationalKinds.enginePlannerCompleted
              ? 'engine.plan'
              : 'engine.stage';
        outcome = result ?? 'unknown';
        timed = true;
        break;
      }
      case operationalKinds.engineStageStarted:
        operation = 'engine.stage';
        outcome = 'started';
        break;
      case operationalKinds.engineStageFailed:
        operation = 'engine.stage';
        outcome = terminal(metadata.outcome) ?? 'failed';
        timed = true;
        break;
      case operationalKinds.voiceToolCalled:
        operation = 'voice.tool';
        outcome = 'started';
        break;
      case operationalKinds.voiceToolResult: {
        const ok = metadata.ok;
        operation = 'voice.tool';
        outcome =
          typeof ok === 'boolean'
            ? (terminal(metadata.outcome) ?? (ok ? 'succeeded' : 'unknown'))
            : 'unknown';
        timed = true;
        break;
      }
      case operationalKinds.voiceToolCancelled:
        operation = 'voice.tool';
        outcome = 'cancelled';
        break;
      default:
        return undefined;
    }
    const durationMs = timed ? duration(metadata) : undefined;
    const base = {
      operation,
      ...(provider === undefined ? {} : { provider }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
    if (
      outcome === 'failed' ||
      outcome === 'skipped' ||
      outcome === 'unknown'
    ) {
      const category = errorCategory(metadata.errorCategory);
      return {
        ...base,
        outcome,
        ...(category === undefined ? {} : { errorCategory: category }),
      };
    }
    return { ...base, outcome };
  } catch {
    if (!Object.hasOwn(terminalOperations, kind)) return undefined;
    return {
      operation: terminalOperations[kind as keyof typeof terminalOperations],
      outcome: 'unknown',
      ...(provider === undefined ? {} : { provider }),
    };
  }
}
