import type {
  TelemetryAttributes,
  TelemetryEvent,
  TelemetrySink,
} from '@maelstrom-co/telemetry';

function swallowSinkError(run: () => void): undefined {
  try {
    run();
  } catch {
    return undefined;
  }

  return undefined;
}

export function emitVoiceSessionTelemetryEvent(
  sink: TelemetrySink | undefined,
  event: TelemetryEvent,
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  return swallowSinkError(() => {
    sink.emitEvent(event);
  });
}

export function recordVoiceSessionTelemetryMetric(
  sink: TelemetrySink | undefined,
  input: {
    name: string;
    value: number;
    attributes?: TelemetryAttributes;
    timestamp?: number;
  },
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  return swallowSinkError(() => {
    sink.recordMetric({
      name: input.name,
      kind: 'counter',
      value: input.value,
      unit: 'count',
      timestamp: input.timestamp,
      attributes: input.attributes,
    });
  });
}

export function recordVoiceSessionTelemetryTiming(
  sink: TelemetrySink | undefined,
  input: {
    name: string;
    duration: number;
    attributes?: TelemetryAttributes;
    timestamp?: number;
  },
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  return swallowSinkError(() => {
    sink.recordTiming({
      name: input.name,
      duration: input.duration,
      unit: 'ms',
      timestamp: input.timestamp,
      attributes: input.attributes,
    });
  });
}
