/** Reported LLM counters, without inferred totals, prices, or missing-value zeros. @internal */
export interface ReportedLlmUsage {
  /** Reported input tokens; cache counters do not increase this value. */
  readonly inputTokens?: number;
  /** Reported output tokens. */
  readonly outputTokens?: number;
  /** Reported total tokens; not derived from input and output counters. */
  readonly totalTokens?: number;
  /** Reported cache-read input tokens. */
  readonly cachedInputTokens?: number;
  /** Reported cache-write input tokens. */
  readonly cacheWriteInputTokens?: number;
  /** Quoted monetary cost in the provider's units, without currency conversion. */
  readonly cost?: number;
}

/** Token counters for one source in a multi-source usage snapshot. @internal */
export type LlmUsageEntry = Omit<ReportedLlmUsage, 'cost'>;

/** Supplemental cache counters and quoted cost for one usage snapshot. @internal */
export interface LlmUsageDetails {
  /** Cache details used only when their corresponding source counter is absent. */
  readonly promptTokensDetails?: {
    /** Reported cache-read input tokens. */
    readonly cachedTokens?: number;
    /** Reported cache-write input tokens. */
    readonly cacheWriteTokens?: number;
  };
  /** Quoted monetary cost in the provider's units. */
  readonly cost?: number;
}

/** Legacy aggregate token counters with supplemental cache and cost details. @internal */
export interface LegacyLlmUsage extends LlmUsageDetails {
  /** Reported input tokens. */
  readonly promptTokens?: number;
  /** Reported output tokens. */
  readonly completionTokens?: number;
  /** Reported total tokens. */
  readonly totalTokens?: number;
}

/** Either legacy aggregate usage or a snapshot containing all source counters. @internal */
export type LlmUsageInput = LegacyLlmUsage | readonly LlmUsageEntry[];

/**
 * Normalizes one usage snapshot without mutating its input or copying metadata.
 * Sums finite, nonnegative source counters and preserves explicit zero.
 * Source cache counters take precedence over supplemental details, so duplicate
 * representations are not added twice. Legacy usage owns its own details.
 * Returns `undefined` when no valid counter or quoted cost was reported.
 * Provider or adapter omissions cannot be recovered at this boundary.
 * Callers own call lifecycles, repeated-snapshot handling, and currency selection.
 * @internal
 */
export function normalizeLlmUsage(
  usage: LlmUsageInput | undefined,
  supplemental?: LlmUsageDetails,
): ReportedLlmUsage | undefined {
  const details = isUsageEntries(usage)
    ? supplemental
    : (usage ?? supplemental);
  const entries = isUsageEntries(usage)
    ? usage
    : usage
      ? [
          {
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
            cacheWriteInputTokens: usage.promptTokensDetails?.cacheWriteTokens,
          },
        ]
      : [];
  const totals: Partial<Record<keyof ReportedLlmUsage, number>> = {};
  for (const entry of entries) {
    for (const key of [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'cachedInputTokens',
      'cacheWriteInputTokens',
    ] as const) {
      const value = entry[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        totals[key] = (totals[key] ?? 0) + value;
    }
  }
  totals.cachedInputTokens ??= details?.promptTokensDetails?.cachedTokens;
  totals.cacheWriteInputTokens ??=
    details?.promptTokensDetails?.cacheWriteTokens;
  totals.cost = details?.cost;
  for (const key of Object.keys(totals) as (keyof ReportedLlmUsage)[]) {
    const value = totals[key];
    if (value === undefined || !Number.isFinite(value) || value < 0)
      delete totals[key];
  }
  return Object.keys(totals).length > 0 ? totals : undefined;
}

function isUsageEntries(
  usage: LlmUsageInput | undefined,
): usage is readonly LlmUsageEntry[] {
  return Array.isArray(usage);
}
