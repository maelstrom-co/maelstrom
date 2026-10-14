import { projectFact } from './project-fact.js';
import type {
  Telemetry,
  TelemetryDrops,
  TelemetryFlushResult,
  TelemetryOptions,
  TelemetryRecord,
  TelemetrySnapshot,
} from './types.js';

type DeliveryState =
  | { readonly status: 'active'; readonly phase: 'idle' | 'scheduled' }
  | {
      readonly status: 'active';
      readonly phase: 'exporting';
      readonly call: ExportCall;
    }
  | { readonly status: 'timed_out' | 'disposed' };

function activeExport(state: DeliveryState): ExportCall | undefined {
  return state.status === 'active' && state.phase === 'exporting'
    ? state.call
    : undefined;
}

const emptyDrops: TelemetryDrops = Object.freeze({
  invalid: 0,
  overflow: 0,
  exportError: 0,
  timeout: 0,
  disabled: 0,
  disposed: 0,
});
const emptySnapshot: TelemetrySnapshot = Object.freeze({
  state: 'disabled',
  accepted: 0,
  delivered: 0,
  queued: 0,
  exporting: 0,
  dropped: emptyDrops,
});

/** Shared disabled lifetime; it evaluates no facts, retains no queue, and initializes no exporter. */
export const noopTelemetry: Telemetry = Object.freeze({
  enabled: false,
  record: () => {},
  getSnapshot: () => emptySnapshot,
  flush: () =>
    Promise.resolve({ outcome: 'disabled' as const, snapshot: emptySnapshot }),
  dispose: () => {},
});

interface QueueItem {
  readonly sequence: number;
  readonly record: TelemetryRecord;
}

interface ExportCall {
  readonly items: readonly QueueItem[];
  readonly abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

interface FlushWaiter {
  readonly target: number;
  readonly resolve: (result: TelemetryFlushResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function boundedInteger(value: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  return value;
}

/**
 * Creates isolated, bounded operational delivery in any environment.
 * No sink returns {@link noopTelemetry}. Export calls run outside record's call stack.
 * Rejected batches drop without retry. A deadline disables the instance to avoid
 * accumulating exporter work that JavaScript cannot forcibly cancel.
 * @throws If enabled queue or deadline options are outside their documented bounds.
 */
export function createTelemetry(options: TelemetryOptions = {}): Telemetry {
  const sink = options.sink;
  if (sink === undefined) return noopTelemetry;
  if (typeof sink !== 'function')
    throw new TypeError('sink must be a function');
  const capacity = boundedInteger(options.capacity ?? 256, 65_536, 'capacity');
  const batchSize = boundedInteger(
    options.batchSize ?? Math.min(32, capacity),
    capacity,
    'batchSize',
  );
  const exportTimeoutMs = boundedInteger(
    options.exportTimeoutMs ?? 1_000,
    60_000,
    'exportTimeoutMs',
  );
  const queue: QueueItem[] = [];
  const waiters = new Set<FlushWaiter>();
  const dropped = { ...emptyDrops };
  let state: DeliveryState = { status: 'active', phase: 'idle' };
  let accepted = 0;
  let completed = 0;
  let delivered = 0;

  const getSnapshot = (): TelemetrySnapshot =>
    Object.freeze({
      state: state.status,
      accepted,
      delivered,
      queued: queue.length,
      exporting: activeExport(state)?.items.length ?? 0,
      dropped: Object.freeze({ ...dropped }),
    });
  const result = (
    outcome: TelemetryFlushResult['outcome'],
  ): TelemetryFlushResult => ({ outcome, snapshot: getSnapshot() });
  const refuseInactive = (): boolean => {
    if (state.status === 'active') return false;
    if (state.status === 'disposed') dropped.disposed++;
    else dropped.disabled++;
    return true;
  };
  const finishWaiters = () => {
    for (const waiter of waiters) {
      const outcome =
        state.status === 'disposed'
          ? 'disposed'
          : state.status !== 'active'
            ? 'disabled'
            : completed >= waiter.target
              ? 'settled'
              : undefined;
      if (outcome === undefined) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(result(outcome));
    }
  };
  const schedule = () => {
    if (
      state.status !== 'active' ||
      state.phase !== 'idle' ||
      queue.length === 0
    )
      return;
    state = { status: 'active', phase: 'scheduled' };
    queueMicrotask(() => {
      if (state.status !== 'active' || state.phase !== 'scheduled') return;
      state = { status: 'active', phase: 'idle' };
      if (queue.length === 0) return;
      // A batch acknowledgement must not make an earlier flush wait for later arrivals.
      let count = batchSize;
      for (const waiter of waiters)
        count = Math.min(count, waiter.target - completed);
      const call: ExportCall = {
        items: queue.splice(0, count),
        abort: new AbortController(),
      };
      state = { status: 'active', phase: 'exporting', call };
      const settle = (failed: boolean) => {
        if (activeExport(state) !== call) return;
        clearTimeout(call.timer);
        state = { status: 'active', phase: 'idle' };
        completed = call.items[call.items.length - 1].sequence;
        if (failed) dropped.exportError += call.items.length;
        else delivered += call.items.length;
        finishWaiters();
        schedule();
      };
      call.timer = setTimeout(() => {
        if (activeExport(state) !== call) return;
        state = { status: 'timed_out' };
        dropped.timeout += call.items.length + queue.length;
        queue.length = 0;
        call.abort.abort(
          new DOMException(
            'Telemetry exporter deadline exceeded',
            'TimeoutError',
          ),
        );
        finishWaiters();
      }, exportTimeoutMs);
      void Promise.resolve()
        .then(() => {
          if (activeExport(state) !== call) return;
          return sink(
            Object.freeze(call.items.map((item) => item.record)),
            call.abort.signal,
          );
        })
        .then(
          () => settle(false),
          () => settle(true),
        );
    });
  };

  return {
    get enabled() {
      return state.status === 'active';
    },
    record(fact) {
      if (refuseInactive()) return;
      const record = projectFact(fact);
      // Fact getters can dispose telemetry during projection.
      if (refuseInactive()) return;
      if (!record) {
        dropped.invalid++;
        return;
      }
      if (queue.length + (activeExport(state)?.items.length ?? 0) >= capacity) {
        dropped.overflow++;
        return;
      }
      queue.push({ sequence: ++accepted, record });
      schedule();
    },
    getSnapshot,
    flush(timeoutMs = 1_000) {
      if (state.status === 'disposed')
        return Promise.resolve(result('disposed'));
      if (state.status !== 'active') return Promise.resolve(result('disabled'));
      boundedInteger(timeoutMs, 60_000, 'timeoutMs');
      if (completed >= accepted) return Promise.resolve(result('settled'));
      const target = accepted;
      return new Promise((resolve) => {
        const waiter: FlushWaiter = {
          target,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(result('deadline_exceeded'));
          }, timeoutMs),
        };
        waiters.add(waiter);
        schedule();
      });
    },
    dispose() {
      if (state.status === 'disposed') return;
      const call = activeExport(state);
      state = { status: 'disposed' };
      dropped.disposed += queue.length + (call?.items.length ?? 0);
      queue.length = 0;
      if (call) {
        clearTimeout(call.timer);
        call.abort.abort(new DOMException('Telemetry disposed', 'AbortError'));
      }
      finishWaiters();
    },
  };
}
