import { projectDiagnosticMetadata } from './diagnostic-metadata.js';
import type {
  Telemetry,
  TelemetryAttachment,
  TelemetryMetadataObserver,
  TelemetryProvider,
} from './types.js';

interface Attachment {
  references: number;
  accepting: boolean;
  readonly scope: string;
  readonly provider?: TelemetryProvider;
  readonly policy?: string | number;
  readonly drained: Promise<void>;
  readonly finish: () => void;
  release?: () => void | PromiseLike<void>;
}
const owners = new WeakMap<object, WeakMap<Telemetry, Attachment>>();
const inactiveAttachment: TelemetryAttachment = Object.freeze({
  release: () => {},
  drained: Promise.resolve(),
});

function isolated(work: () => unknown): void {
  try {
    const result = work();
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      'then' in result
    )
      void Promise.resolve(result).catch(() => {});
  } catch {
    /* Optional observation cannot change producer work. */
  }
}

/**
 * Shares one producer subscription per owner and application telemetry lifetime.
 * Sources receive no exporter or content capabilities. The shared drain completes after
 * the last release finishes, including any accepted outcomes published during retirement.
 * Source failures report loss and fence leaked callbacks. Cleanup is never retried.
 * @internal
 */
export function attachTelemetrySource(
  owner: object,
  telemetry: Telemetry | undefined,
  scope: 'client' | 'engine' | 'voice',
  start: (
    observer: TelemetryMetadataObserver,
  ) => () => void | PromiseLike<void>,
  provider?: TelemetryProvider,
  policy?: string | number,
): TelemetryAttachment {
  let enabled = false;
  isolated(() => {
    enabled = telemetry?.enabled === true;
  });
  if (!telemetry || !enabled) return inactiveAttachment;
  let consumers = owners.get(owner);
  if (!consumers) {
    consumers = new WeakMap();
    owners.set(owner, consumers);
  }
  let attachment = consumers.get(telemetry);
  if (
    attachment &&
    (attachment.scope !== scope ||
      attachment.provider !== provider ||
      attachment.policy !== policy)
  )
    throw new RangeError(
      'A producer telemetry attachment must retain its original category and policy',
    );
  const reportLoss = () =>
    isolated(() =>
      telemetry.record({
        operation: 'telemetry.source',
        outcome: 'discarded',
        ...(provider === undefined ? {} : { provider }),
      }),
    );
  if (attachment) attachment.references++;
  else {
    let finish!: () => void;
    const drained = new Promise<void>((resolve) => {
      finish = resolve;
    });
    attachment = {
      references: 1,
      accepting: true,
      scope,
      provider,
      policy,
      drained,
      finish,
    };
    consumers.set(telemetry, attachment);
    const current = attachment;
    try {
      current.release = start((kind, metadata) => {
        isolated(() => {
          if (!current.accepting || !kind.startsWith(`${scope}.`)) return;
          const fact = projectDiagnosticMetadata(kind, metadata, provider);
          if (fact) return telemetry.record(fact);
        });
      });
    } catch {
      current.accepting = false;
      if (consumers.get(telemetry) === current) consumers.delete(telemetry);
      reportLoss();
      current.finish();
      return inactiveAttachment;
    }
  }
  const current = attachment;
  const subscriptions = consumers;
  let released = false;
  return {
    drained: current.drained,
    release() {
      if (released) return;
      released = true;
      if (--current.references !== 0) return;
      if (subscriptions.get(telemetry) === current)
        subscriptions.delete(telemetry);
      const release = current.release;
      current.release = undefined;
      const finish = () => {
        current.accepting = false;
        current.finish();
      };
      const failed = () => {
        current.accepting = false;
        reportLoss();
        current.finish();
      };
      try {
        const pending = release?.();
        if (pending === undefined) finish();
        else void Promise.resolve(pending).then(finish, failed);
      } catch {
        failed();
      }
    },
  };
}
