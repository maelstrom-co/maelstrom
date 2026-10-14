import type {
  telemetryErrorCategories,
  telemetryLayoutModes,
  telemetryOperations,
  telemetryOutcomes,
  telemetryProviders,
} from './vocabulary.js';

/** Bounded operation categories; nested stages remain separate from whole requests. */
export type TelemetryOperation = (typeof telemetryOperations)[number];

/** Operational evidence. Success does not establish task completion, paint, or audible speech. */
export type TelemetryOutcome = (typeof telemetryOutcomes)[number];

/** Application-selected provider categories; custom provider names never become dimensions. */
export type TelemetryProvider = (typeof telemetryProviders)[number];

/** Stable failure categories, independent of arbitrary provider or application error text. */
export type TelemetryErrorCategory = (typeof telemetryErrorCategories)[number];

/** Outcome evidence with categories only where failure or unavailable work can explain it. */
export type TelemetryOutcomeDetails =
  | {
      /** A known failure, skipped work, or insufficient outcome evidence. */
      readonly outcome: 'failed' | 'skipped' | 'unknown';
      /** Classified cause; unknown denotes an unclassified cause, while omission supplies no classification. */
      readonly errorCategory?: TelemetryErrorCategory;
    }
  | {
      /** A phase or result with no failure classification. */
      readonly outcome: Exclude<
        TelemetryOutcome,
        'failed' | 'skipped' | 'unknown'
      >;
      /** Error categories are unavailable for this outcome. */
      readonly errorCategory?: never;
    };

/** The complete metric dimension allowlist. Identifiers and content have no representation here. */
export type TelemetryAttributes = TelemetryOutcomeDetails & {
  /** Unit of work whose evidence was observed. */
  readonly operation: TelemetryOperation;
  /** Optional application-selected provider category; omission means unknown. */
  readonly provider?: TelemetryProvider;
  /** Layout algorithm, when the producer knows it. */
  readonly layoutMode?: (typeof telemetryLayoutModes)[number];
};

/** One producer fact. Extra runtime fields are discarded before queueing or sink delivery. */
export type TelemetryFact = TelemetryAttributes & {
  /** Nonnegative duration measured within one process; omission preserves unknown timing. */
  readonly durationMs?: number;
};

/** Measurements exported independently of any downstream detailed trace sampling. */
export type TelemetryMeasurement =
  | {
      /** Add this observation to the operation count. */
      readonly type: 'counter';
      /** Stable instrument name. Count started and terminal outcomes separately. */
      readonly name: 'maelstrom.operation.count';
      /** One observed operation phase. */
      readonly unit: '{operation}';
      /** Each accepted fact contributes exactly one observation. */
      readonly value: 1;
    }
  | {
      /** Record the local duration distribution. */
      readonly type: 'histogram';
      /** Stable instrument name; never sum nested stage durations as request latency. */
      readonly name: 'maelstrom.operation.duration';
      /** Milliseconds on the producer's own clock. */
      readonly unit: 'ms';
      /** Finite, nonnegative local duration. */
      readonly value: number;
    };

/** Immutable, content-free export record for one accepted fact. */
export interface TelemetryRecord {
  /** Fixed dimension allowlist shared by this record's measurements. */
  readonly attributes: TelemetryAttributes;
  /** One counter and, when known, one local duration histogram observation. */
  readonly measurements: readonly TelemetryMeasurement[];
}

/**
 * Application-owned batch exporter. Initialize SDKs and network destinations outside libraries.
 * Fulfillment acknowledges batch acceptance; throws and rejections drop it without retry.
 * HTTP exporters must check response status and throw for unsuccessful responses.
 * Await only work bounded by exportTimeoutMs, or acknowledge acceptance into an application-owned queue.
 * The signal carries a TimeoutError on the fatal exporter deadline or an AbortError on disposal.
 * Exporters must cooperate to stop external work; inspect snapshot.state to detect timed_out delivery.
 */
export type TelemetrySink = (
  batch: readonly TelemetryRecord[],
  signal: AbortSignal,
) => void | PromiseLike<void>;

/** Fixed reasons for lost facts, counted independently of the failing exporter. */
export interface TelemetryDrops {
  /** Facts with invalid allowlisted fields; no arbitrary fields are inspected. */
  readonly invalid: number;
  /** New facts refused because queued and exporting records filled the capacity. */
  readonly overflow: number;
  /** Records lost when the exporter threw or rejected. */
  readonly exportError: number;
  /** Exporting and queued records abandoned when an exporter exceeded its deadline. */
  readonly timeout: number;
  /** New facts refused after an exporter deadline disabled this instance. */
  readonly disabled: number;
  /** Pending records abandoned at disposal, plus new facts refused after disposal. */
  readonly disposed: number;
}

/** Local delivery accounting. A successful exporter call does not prove backend persistence. */
export interface TelemetrySnapshot {
  /** Timed-out instances stay disabled; create a new instance to attach a replacement sink. */
  readonly state: 'active' | 'disabled' | 'timed_out' | 'disposed';
  /** Total facts accepted into the bounded queue. */
  readonly accepted: number;
  /** Records acknowledged by a fulfilled exporter call. */
  readonly delivered: number;
  /** Records waiting for the single exporter slot. */
  readonly queued: number;
  /** Records held by the one active exporter call. */
  readonly exporting: number;
  /** Cumulative local loss counters; no network is used to report them. */
  readonly dropped: TelemetryDrops;
}

/** Result for the facts accepted before a flush began; later arrivals cannot extend its barrier. */
export interface TelemetryFlushResult {
  /** Settled includes exporter rejection; inspect delivery and loss counts. */
  readonly outcome: 'settled' | 'deadline_exceeded' | 'disabled' | 'disposed';
  /** Delivery accounting when this flush completed. */
  readonly snapshot: TelemetrySnapshot;
}

/** Explicit queue policy. No sink creates a shared no-op with no retained facts or timers. */
export interface TelemetryOptions {
  /** Application-owned exporter; omission disables telemetry in every environment. */
  readonly sink?: TelemetrySink;
  /** Maximum queued plus exporting records, from 1 to 65,536. Defaults to 256. */
  readonly capacity?: number;
  /** Maximum records per exporter call, from 1 to capacity. Defaults to min(32, capacity). */
  readonly batchSize?: number;
  /** Exporter deadline, from 1 to 60,000 milliseconds. Defaults to 1,000. */
  readonly exportTimeoutMs?: number;
}

/** Per-application telemetry lifetime, independent of DevTools, recordings, and remote forwarding. */
export interface Telemetry {
  /** Whether this instance currently accepts facts. */
  readonly enabled: boolean;
  /** Validate and enqueue one fact without invoking or waiting for the exporter. */
  record(fact: TelemetryFact): void;
  /** Read local counters without exporting or exposing application content. */
  getSnapshot(): TelemetrySnapshot;
  /**
   * Wait for previously accepted facts to settle. The default deadline is 1,000 milliseconds.
   * A flush deadline leaves export work running; an exporter deadline disables delivery.
   * Do not await this method from inside the sink that it is waiting for.
   * @throws If timeoutMs is not an integer from 1 to 60,000 on an enabled instance.
   */
  flush(timeoutMs?: number): Promise<TelemetryFlushResult>;
  /** Abort delivery and drop pending records immediately. Flush first when delivery matters. */
  dispose(): void;
}
