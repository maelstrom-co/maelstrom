import {
  createTelemetry,
  type TelemetryAttachment,
  type TelemetryOptions,
} from '@maelstrom-co/telemetry';
import {
  type OperationalGroup,
  type OperationalTelemetry,
  validateOperationalTelemetry,
} from './runtime/operational-telemetry.js';

export {
  type OperationalTelemetry,
  unavailableOperationalTelemetry,
  validateOperationalTelemetry,
} from './runtime/operational-telemetry.js';

/** Creates an isolated, bounded collector; attach only producers owned by the declared scope. */
export function createOperationalCollector(
  scope: OperationalTelemetry['scope'],
  options: Omit<TelemetryOptions, 'sink'> = {},
) {
  let groups = new Map<string, OperationalGroup>();
  let closed = false;
  let finalized: Promise<OperationalTelemetry> | undefined;
  const telemetry = createTelemetry({
    ...options,
    sink(batch) {
      if (closed) throw new Error('Collection finalized');
      const next = new Map(groups);
      for (const record of batch) {
        const { operation, outcome } = record.attributes;
        const key = `${operation}/${outcome}`;
        const prior = next.get(key) ?? {
          operation,
          outcome,
          count: 0,
          durationSampleCount: 0,
        };
        let { count, durationSampleCount, durationMeanMs } = prior;
        for (const measurement of record.measurements) {
          if (measurement.type === 'counter') count += measurement.value;
          else {
            durationSampleCount++;
            durationMeanMs =
              durationMeanMs === undefined
                ? measurement.value
                : durationMeanMs +
                  (measurement.value - durationMeanMs) / durationSampleCount;
          }
        }
        if (
          !Number.isSafeInteger(count) ||
          !Number.isSafeInteger(durationSampleCount)
        )
          throw new Error('Collection overflow');
        next.set(key, {
          operation,
          outcome,
          count,
          durationSampleCount,
          ...(durationMeanMs !== undefined && { durationMeanMs }),
        });
      }
      groups = next;
    },
  });
  return {
    telemetry,
    /** Stop callers first; retire owned attachments before fencing the queue and freezing evidence. */
    finalize(
      attachments: readonly TelemetryAttachment[] = [],
    ): Promise<OperationalTelemetry> {
      finalized ??= (async () => {
        let sourceDrained = true;
        for (const attachment of attachments) {
          try {
            attachment.release();
          } catch {
            sourceDrained = false;
          }
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const drained = await Promise.race([
          Promise.all(attachments.map((attachment) => attachment.drained)).then(
            () => true,
            () => false,
          ),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1_000);
          }),
        ]);
        clearTimeout(timer);
        sourceDrained &&= drained;
        const flush = await telemetry.flush();
        closed = true;
        telemetry.dispose();
        const snapshot = telemetry.getSnapshot();
        const partial =
          !sourceDrained ||
          flush.outcome !== 'settled' ||
          Object.values(snapshot.dropped).some((value) => value > 0) ||
          groups.has('telemetry.source/discarded');
        return validateOperationalTelemetry({
          schemaVersion: 1,
          scope,
          completeness: partial ? 'partial' : 'complete',
          groups: [...groups.values()].sort((a, b) =>
            `${a.operation}/${a.outcome}`.localeCompare(
              `${b.operation}/${b.outcome}`,
            ),
          ),
          collection: { snapshot, flushOutcome: flush.outcome, sourceDrained },
        });
      })();
      return finalized;
    },
  };
}
