import type {
  TelemetryAttributes,
  TelemetryFact,
  TelemetryMeasurement,
  TelemetryRecord,
} from './types.js';

import {
  telemetryErrorCategories,
  telemetryLayoutModes,
  telemetryOperations,
  telemetryOutcomes,
  telemetryProviders,
} from './vocabulary.js';

const operations: ReadonlySet<string> = new Set(telemetryOperations);
const outcomes: ReadonlySet<string> = new Set(telemetryOutcomes);
const providers: ReadonlySet<string> = new Set(telemetryProviders);
const errors: ReadonlySet<string> = new Set(telemetryErrorCategories);
const layouts: ReadonlySet<string> = new Set(telemetryLayoutModes);
const count: TelemetryMeasurement = Object.freeze({
  type: 'counter',
  name: 'maelstrom.operation.count',
  unit: '{operation}',
  value: 1,
});

export function projectFact(fact: TelemetryFact): TelemetryRecord | undefined {
  try {
    const {
      operation,
      outcome,
      provider,
      errorCategory,
      layoutMode,
      durationMs,
    } = fact;
    if (
      !operations.has(operation) ||
      !outcomes.has(outcome) ||
      (provider !== undefined && !providers.has(provider)) ||
      (errorCategory !== undefined &&
        (!errors.has(errorCategory) ||
          (outcome !== 'failed' &&
            outcome !== 'skipped' &&
            outcome !== 'unknown'))) ||
      (layoutMode !== undefined && !layouts.has(layoutMode)) ||
      (durationMs !== undefined &&
        (typeof durationMs !== 'number' ||
          !Number.isFinite(durationMs) ||
          durationMs < 0))
    )
      return undefined;
    const attributes = Object.freeze({
      operation,
      outcome,
      ...(provider === undefined ? {} : { provider }),
      ...(errorCategory === undefined ? {} : { errorCategory }),
      ...(layoutMode === undefined ? {} : { layoutMode }),
    } as TelemetryAttributes);
    const measurements: TelemetryMeasurement[] = [count];
    if (durationMs !== undefined)
      measurements.push(
        Object.freeze({
          type: 'histogram',
          name: 'maelstrom.operation.duration',
          unit: 'ms',
          value: durationMs,
        }),
      );
    return Object.freeze({
      attributes,
      measurements: Object.freeze(measurements),
    });
  } catch {
    return undefined;
  }
}
