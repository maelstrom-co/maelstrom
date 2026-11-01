// Versioned score vocabulary, deliberately independent of extensible diagnostic kinds.
const operations = [
  'client.request',
  'client.apply',
  'client.action',
  'engine.request',
  'engine.plan',
  'engine.stage',
  'telemetry.source',
  'voice.tool',
] as const;
const outcomes = [
  'started',
  'succeeded',
  'succeeded_with_issues',
  'failed',
  'cancelled',
  'discarded',
  'skipped',
  'unknown',
] as const;
const dropReasons = [
  'invalid',
  'overflow',
  'exportError',
  'timeout',
  'disabled',
  'disposed',
] as const;

type TelemetryOperation = (typeof operations)[number];
type TelemetryOutcome = (typeof outcomes)[number];
/** Snapshot of local delivery, not an acknowledgment from the eventual reporting backend. */
export interface OperationalSnapshot {
  /** Local exporter state when the immutable snapshot was taken. */
  readonly state: 'active' | 'disabled' | 'timed_out' | 'disposed';
  /** Facts admitted into the local queue, including those subsequently lost. */
  readonly accepted: number;
  /** Records aggregated locally, not confirmed stored in Langfuse. */
  readonly delivered: number;
  /** Accepted records not yet handed to the local aggregator. */
  readonly queued: number;
  /** Accepted records still held by an exporter call. */
  readonly exporting: number;
  /** Both rejected new facts and losses after admission, by fixed reason. */
  readonly dropped: Readonly<Record<(typeof dropReasons)[number], number>>;
}
type FlushOutcome = 'settled' | 'deadline_exceeded' | 'disabled' | 'disposed';

/** One bounded operation/outcome group; duration denominator excludes absent measurements. */
export interface OperationalGroup {
  /** Versioned operation category, never an arbitrary stage name. */
  readonly operation: TelemetryOperation;
  /** Observation phase; started and terminal outcomes must not be combined. */
  readonly outcome: TelemetryOutcome;
  /** Sum of received counter observations, not an inferred total under loss. */
  readonly count: number;
  /** Denominator of the duration mean; missing durations do not contribute. */
  readonly durationSampleCount: number;
  /** Mean measured milliseconds, absent when the denominator is zero. */
  readonly durationMeanMs?: number;
}

/** Finalized local collection evidence, independent of task correctness and backend delivery. */
export interface OperationalTelemetry {
  /** Version of the bounded grouping and score semantics. */
  readonly schemaVersion: 1;
  /** Ownership is declared by the collector's caller, never inferred from event timing. */
  readonly scope: 'sample' | 'run';
  /** Local collection completeness only, not migration or task completeness. */
  readonly completeness: 'complete' | 'partial' | 'unavailable';
  /** Only observed groups; missing groups are not zero-operation scores. */
  readonly groups: readonly OperationalGroup[];
  /** Absent only when no collection was available. */
  readonly collection?: {
    /** Final local delivery and loss counters. */
    readonly snapshot: OperationalSnapshot;
    /** Settled does not imply lossless delivery. */
    readonly flushOutcome: FlushOutcome;
    /** Whether all owned sources retired before finalization. */
    readonly sourceDrained: boolean;
  };
}

/** Absence is not a zero-operation measurement. */
export function unavailableOperationalTelemetry(
  scope: OperationalTelemetry['scope'] = 'sample',
): OperationalTelemetry {
  return Object.freeze({
    schemaVersion: 1,
    scope,
    completeness: 'unavailable',
    groups: Object.freeze([]),
  });
}

/** Rejects unknown fields/versions, invalid dimensions and inconsistent imported aggregate evidence. */
export function validateOperationalTelemetry(
  value: unknown,
): OperationalTelemetry {
  const invalid = () => {
    throw new Error('Invalid operational telemetry');
  };
  const object = (
    item: unknown,
    fields: readonly string[],
  ): Record<string, unknown> => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => !fields.includes(key))
    )
      return invalid();
    return item as Record<string, unknown>;
  };
  const integer = (item: unknown): number =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
      ? item
      : invalid();
  const root = object(value, [
    'schemaVersion',
    'scope',
    'completeness',
    'groups',
    'collection',
  ]);
  if (
    root.schemaVersion !== 1 ||
    !(['sample', 'run'] as readonly unknown[]).includes(root.scope) ||
    !(['complete', 'partial', 'unavailable'] as readonly unknown[]).includes(
      root.completeness,
    ) ||
    !Array.isArray(root.groups) ||
    root.groups.length > operations.length * outcomes.length
  )
    return invalid();
  const seen = new Set<string>();
  const groups = Array.from(root.groups, (item): OperationalGroup => {
    const group = object(item, [
      'operation',
      'outcome',
      'count',
      'durationSampleCount',
      'durationMeanMs',
    ]);
    if (
      !(operations as readonly unknown[]).includes(group.operation) ||
      !(outcomes as readonly unknown[]).includes(group.outcome)
    )
      return invalid();
    const key = `${group.operation}/${group.outcome}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    const count = integer(group.count);
    const durationSampleCount = integer(group.durationSampleCount);
    const mean = group.durationMeanMs;
    if (
      count < 1 ||
      durationSampleCount > count ||
      (durationSampleCount === 0
        ? Object.hasOwn(group, 'durationMeanMs')
        : typeof mean !== 'number' || !Number.isFinite(mean) || mean < 0)
    )
      return invalid();
    return Object.freeze({
      operation: group.operation as TelemetryOperation,
      outcome: group.outcome as TelemetryOutcome,
      count,
      durationSampleCount,
      ...(typeof mean === 'number' && { durationMeanMs: mean }),
    });
  });
  const scope = root.scope as OperationalTelemetry['scope'];
  if (root.completeness === 'unavailable') {
    if (groups.length || root.collection !== undefined) return invalid();
    return unavailableOperationalTelemetry(scope);
  }
  const collection = object(root.collection, [
    'snapshot',
    'flushOutcome',
    'sourceDrained',
  ]);
  const snapshot = object(collection.snapshot, [
    'state',
    'accepted',
    'delivered',
    'queued',
    'exporting',
    'dropped',
  ]);
  if (
    !(
      ['active', 'disabled', 'timed_out', 'disposed'] as readonly unknown[]
    ).includes(snapshot.state) ||
    !(
      [
        'settled',
        'deadline_exceeded',
        'disabled',
        'disposed',
      ] as readonly unknown[]
    ).includes(collection.flushOutcome) ||
    typeof collection.sourceDrained !== 'boolean'
  )
    return invalid();
  const dropped = object(snapshot.dropped, dropReasons);
  for (const key of dropReasons) integer(dropped[key]);
  for (const key of ['accepted', 'delivered', 'queued', 'exporting'])
    integer(snapshot[key]);
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  const accounted =
    (snapshot.delivered as number) +
    (snapshot.queued as number) +
    (snapshot.exporting as number) +
    (dropped.exportError as number) +
    (dropped.timeout as number);
  // Disposal counts include both accepted pending work and later refused facts.
  if (
    !Number.isSafeInteger(accounted) ||
    (snapshot.accepted as number) < accounted ||
    (snapshot.accepted as number) - accounted > (dropped.disposed as number)
  )
    return invalid();
  if (
    !Number.isSafeInteger(count) ||
    count !== snapshot.delivered ||
    (snapshot.delivered as number) > (snapshot.accepted as number)
  )
    return invalid();
  if (
    root.completeness === 'complete' &&
    (!collection.sourceDrained ||
      collection.flushOutcome !== 'settled' ||
      snapshot.queued !== 0 ||
      snapshot.exporting !== 0 ||
      snapshot.accepted !== snapshot.delivered ||
      Object.values(dropped).some((n) => n !== 0) ||
      seen.has('telemetry.source/discarded'))
  )
    return invalid();
  return Object.freeze({
    schemaVersion: 1,
    scope,
    completeness: root.completeness as 'complete' | 'partial',
    groups: Object.freeze(groups),
    collection: Object.freeze({
      snapshot: Object.freeze({
        ...snapshot,
        dropped: Object.freeze({ ...dropped }),
      }) as unknown as OperationalSnapshot,
      flushOutcome: collection.flushOutcome as FlushOutcome,
      sourceDrained: collection.sourceDrained,
    }),
  });
}
