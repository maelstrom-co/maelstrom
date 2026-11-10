import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai';

import { normalizeLlmUsage, type ReportedLlmUsage } from './usage.js';

/**
 * One provider call observed by {@link withUsage}.
 *
 * Retries and finalization calls each produce their own record.
 * @internal
 */
export interface ProviderCallRecord<Role extends string = string> {
  /** The role the adapter was wrapped with. */
  readonly role: Role;
  /**
   * The model that served the call: the model on the terminal chunk or
   * structured output result when present, otherwise the wrapped adapter's
   * `model` property. A delegating adapter that forwards inner chunks
   * therefore reports the inner model.
   */
  readonly model: string;
  /**
   * Wall-clock time until the call ended or settled, measured from the first
   * pull for a streamed call and from the call for `structuredOutput`.
   */
  readonly latencyMs: number;
  /**
   * True only when a streamed call delivered `RUN_FINISHED`, or a
   * `structuredOutput` call resolved. Failed, abandoned and aborted calls are
   * false.
   */
  readonly completed: boolean;
  /** Absent when the provider reported no counter, never filled with zeros. */
  readonly usage?: ReportedLlmUsage;
}

/**
 * Usage summed over the records a {@link UsageLedger} holds.
 * @internal
 */
export interface UsageLedgerSnapshot {
  /** Records included in this snapshot. */
  readonly calls: number;
  /** Records without any reported usage, including incomplete calls. */
  readonly unreportedCalls: number;
  /**
   * Records that completed without reported usage. A nonzero value points at
   * an adapter that drops its provider's usage.
   */
  readonly completedWithoutUsage: number;
  /**
   * Records that reported usage but lacked `inputTokens` or `outputTokens`.
   * Their missing counter is absent from {@link usage}, so a sum over it
   * undercounts.
   */
  readonly partialUsageCalls: number;
  /**
   * Per-counter sum over the records that reported usage. A counter no record
   * reported stays absent, and a reported zero stays zero. Counters other than
   * input and output tokens, such as cost, cache and the provider total, are
   * sums over only the calls that reported them and may be partial.
   */
  readonly usage: ReportedLlmUsage;
}

/**
 * Selects the records a {@link UsageLedger.snapshot} sums.
 * @internal
 */
export interface UsageLedgerFilter<Role extends string = string> {
  /** Only records with this role. */
  readonly role?: Role;
}

/**
 * Collects {@link ProviderCallRecord}s and sums them on demand.
 * @internal
 */
export interface UsageLedger<Role extends string = string> {
  /** Appends one record. Safe to pass unbound as a {@link withUsage} sink. */
  readonly record: (call: ProviderCallRecord<Role>) => void;
  /** Sums the records matching `filter`, or every record when omitted. */
  readonly snapshot: (filter?: UsageLedgerFilter<Role>) => UsageLedgerSnapshot;
}

/**
 * Wraps `adapter` so every provider call sends exactly one
 * {@link ProviderCallRecord} to `sink` when the call ends, however it ends,
 * including a method that throws synchronously. The error still reaches the
 * caller. An error thrown by `sink` is swallowed, so it never replaces the
 * adapter's result or error. A streamed call starts on its first pull, so a
 * stream that is never pulled records nothing.
 *
 * Streamed calls take usage from the first `RUN_FINISHED` or `RUN_ERROR`
 * chunk that reports any, and `structuredOutput` from its result. Methods run
 * with the original adapter as `this`, and a method the adapter lacks stays
 * absent, because `chat()` picks its path by probing for
 * `structuredOutputStream`. Counter presence is preserved at the adapter
 * boundary, but normalization done inside the adapter cannot be undone.
 * Provider SDK retries below the adapter are invisible here.
 * @internal
 */
export function withUsage<Role extends string>(
  adapter: AnyTextAdapter,
  role: Role,
  sink: (call: ProviderCallRecord<Role>) => void,
): AnyTextAdapter {
  return new Proxy(Object.create(adapter) as AnyTextAdapter, {
    get(_shadow, property) {
      const value: unknown = Reflect.get(adapter, property, adapter);
      if (typeof value !== 'function') return value;
      if ((STREAMS as readonly PropertyKey[]).includes(property))
        return (...args: unknown[]) =>
          recordStream(() => value.apply(adapter, args), adapter, role, sink);
      if (property === 'structuredOutput')
        return async (...args: unknown[]) => {
          const started = performance.now();
          let usage: ReportedLlmUsage | undefined;
          let model: string | undefined;
          let completed = false;
          try {
            const result = await value.apply(adapter, args);
            usage = normalizeLlmUsage(result?.usage);
            model = result?.model;
            completed = true;
            return result;
          } finally {
            report(
              sink,
              providerCall(
                role,
                model ?? adapter.model,
                started,
                completed,
                usage,
              ),
            );
          }
        };
      return value.bind(adapter);
    },
  });
}

/**
 * Creates an in-memory ledger of provider calls.
 * @internal
 */
export function createUsageLedger<
  Role extends string = string,
>(): UsageLedger<Role> {
  const records: ProviderCallRecord<Role>[] = [];
  return {
    record: (call) => {
      records.push(call);
    },
    snapshot: (filter) => {
      const selected =
        filter?.role === undefined
          ? records
          : records.filter((call) => call.role === filter.role);
      const usage: Partial<Record<keyof ReportedLlmUsage, number>> = {};
      let unreportedCalls = 0;
      let completedWithoutUsage = 0;
      let partialUsageCalls = 0;
      for (const call of selected) {
        if (!call.usage) {
          unreportedCalls++;
          if (call.completed) completedWithoutUsage++;
          continue;
        }
        if (
          call.usage.inputTokens === undefined ||
          call.usage.outputTokens === undefined
        )
          partialUsageCalls++;
        for (const key of USAGE_COUNTERS) {
          const value = call.usage[key];
          if (value !== undefined) usage[key] = (usage[key] ?? 0) + value;
        }
      }
      return {
        calls: selected.length,
        unreportedCalls,
        completedWithoutUsage,
        partialUsageCalls,
        usage,
      };
    },
  };
}

/**
 * Returns input plus output tokens spent across a snapshot, retries and
 * finalization included. Returns `undefined` when any call reported no usage
 * or lacked an input or output counter, or when either summed counter is
 * absent, so an unknown spend is never read as zero. An empty snapshot returns 0.
 * @internal
 */
export function totalTokens(snapshot: UsageLedgerSnapshot): number | undefined {
  if (snapshot.unreportedCalls > 0 || snapshot.partialUsageCalls > 0)
    return undefined;
  if (snapshot.calls === 0) return 0;
  const { inputTokens, outputTokens } = snapshot.usage;
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return inputTokens + outputTokens;
}

const STREAMS = ['chatStream', 'structuredOutputStream'] as const;

const USAGE_COUNTERS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'cost',
] as const satisfies readonly (keyof ReportedLlmUsage)[];

async function* recordStream<Role extends string>(
  open: () => AsyncIterable<StreamChunk>,
  adapter: AnyTextAdapter,
  role: Role,
  sink: (call: ProviderCallRecord<Role>) => void,
): AsyncGenerator<StreamChunk> {
  const started = performance.now();
  let usage: ReportedLlmUsage | undefined;
  let model: string | undefined;
  let completed = false;
  try {
    for await (const chunk of open()) {
      if (chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR') {
        usage ??= normalizeLlmUsage(
          chunk.usage,
          chunk.metadata?.tanstack?.usage,
        );
        model ??= chunk.model ?? chunk.metadata?.tanstack?.model;
        if (chunk.type === 'RUN_FINISHED') completed = true;
      }
      yield chunk;
    }
  } finally {
    report(
      sink,
      providerCall(role, model ?? adapter.model, started, completed, usage),
    );
  }
}

function report<Role extends string>(
  sink: (call: ProviderCallRecord<Role>) => void,
  call: ProviderCallRecord<Role>,
): void {
  try {
    sink(call);
  } catch {
    // A sink failure must not replace the adapter's result or error.
  }
}

function providerCall<Role extends string>(
  role: Role,
  model: string,
  started: number,
  completed: boolean,
  usage: ReportedLlmUsage | undefined,
): ProviderCallRecord<Role> {
  return {
    role,
    model,
    latencyMs: performance.now() - started,
    completed,
    ...(usage && { usage }),
  };
}
