import type {
  AudioTimelineMeasurement,
  SpeechSegment,
} from './shared-audio-timeline.ts';

export const singleTurnMinimumVadCoverageRatio = 0.5;

export type SpeechCoverage = {
  readonly expectedActiveMs: number;
  readonly capturedActiveMs: number;
  readonly coverageRatio: number | null;
  readonly minimumCoverageRatio: number;
};

export type SingleTurnValidityReason =
  | 'assistant-onset-overlapped-human-speech'
  | 'captured-vad-coverage-below-minimum'
  | 'vad-coverage-unavailable'
  | 'malformed-vad-input'
  | 'capture-failed';

export type SingleTurnValidity = {
  readonly valid: boolean;
  readonly reasons: readonly SingleTurnValidityReason[];
};

export type VadValidation = {
  readonly valid: boolean;
  readonly reason:
    | 'malformed-vad-data'
    | 'invalid-sample-rate'
    | 'invalid-channel-count'
    | 'invalid-frame-count'
    | 'invalid-vad-segments'
    | 'sample-clock-mismatch'
    | null;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  readonly segments: readonly SpeechSegment[];
};

export function validateVadPayload(
  payload: unknown,
  frameCount: number,
): VadValidation {
  if (typeof payload !== 'object' || payload === null)
    return invalidVad('malformed-vad-data');
  const value = payload as Record<string, unknown>;
  const sampleRate = value.sampleRate;
  const channels = value.channels;
  const rawSegments = value.segments;
  if (
    typeof sampleRate !== 'number' ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0
  )
    return invalidVad('invalid-sample-rate');
  if (!Number.isInteger(channels) || (channels as number) <= 0)
    return invalidVad('invalid-channel-count', sampleRate);
  if (!Number.isSafeInteger(frameCount) || frameCount < 0)
    return invalidVad('invalid-frame-count', sampleRate, channels as number);
  if (!Array.isArray(rawSegments))
    return invalidVad('malformed-vad-data', sampleRate, channels as number);

  const segments: SpeechSegment[] = [];
  let previousEnd = 0;
  for (const rawSegment of rawSegments) {
    if (typeof rawSegment !== 'object' || rawSegment === null)
      return invalidVad('invalid-vad-segments', sampleRate, channels as number);
    const { StartSample: startSample, EndSample: endSample } =
      rawSegment as Record<string, unknown>;
    if (
      typeof startSample !== 'number' ||
      typeof endSample !== 'number' ||
      !Number.isSafeInteger(startSample) ||
      !Number.isSafeInteger(endSample) ||
      startSample < previousEnd ||
      startSample < 0 ||
      endSample <= startSample ||
      endSample > frameCount
    )
      return invalidVad('invalid-vad-segments', sampleRate, channels as number);
    segments.push({ startSample, endSample });
    previousEnd = endSample;
  }
  return {
    valid: true,
    reason: null,
    sampleRate,
    channels: channels as number,
    segments,
  };
}

export function attachReportAndCleanup<T>(
  report: T,
  attach: (value: T) => Promise<unknown>,
  cleanup: readonly (() => Promise<unknown>)[],
): Promise<void> {
  return (async () => {
    let attachFailed = false;
    let attachError: unknown;
    try {
      await attach(report);
    } catch (error) {
      attachFailed = true;
      attachError = error;
    }
    for (const action of cleanup) {
      try {
        await action();
      } catch {}
    }
    if (attachFailed) throw attachError;
  })();
}

function invalidVad(
  reason: NonNullable<VadValidation['reason']>,
  sampleRate: number | null = null,
  channels: number | null = null,
): VadValidation {
  return { valid: false, reason, sampleRate, channels, segments: [] };
}

export function requireNonemptyFixtureVad(
  validation: VadValidation,
  sourceFormat?: { readonly sampleRate: number; readonly channels: number },
): VadValidation & { readonly valid: true; readonly sampleRate: number } {
  if (!validation.valid)
    throw new Error(`Fixture VAD preflight is malformed: ${validation.reason}`);
  if (validation.segments.length === 0)
    throw new Error('Fixture VAD preflight returned no speech segments');
  if (validation.sampleRate === null)
    throw new Error('Fixture VAD preflight has no valid sample rate');
  if (
    sourceFormat &&
    (validation.sampleRate !== sourceFormat.sampleRate ||
      validation.channels !== sourceFormat.channels)
  )
    throw new Error('Fixture VAD preflight sample clock does not match source');
  return validation as VadValidation & {
    readonly valid: true;
    readonly sampleRate: number;
  };
}

export function addAttemptFailure(
  failures: number,
  executionFailed: boolean,
  invalidReason: string | null,
): number {
  return failures + (executionFailed || invalidReason !== null ? 1 : 0);
}

export function analyzeSingleTurnValidity(args: {
  readonly latency: AudioTimelineMeasurement;
  readonly expected: {
    readonly segments: readonly SpeechSegment[];
    readonly sampleRate: number;
  } | null;
  readonly captured: {
    readonly segments: readonly SpeechSegment[];
    readonly sampleRate: number;
  } | null;
  readonly malformedVadInput: boolean;
  readonly captureFailed: boolean;
}): {
  readonly coverage: SpeechCoverage | null;
  readonly validity: SingleTurnValidity;
  readonly analysisFailed: boolean;
} {
  try {
    const coverage =
      args.expected && args.captured
        ? calculateSpeechCoverage({
            expectedSegments: args.expected.segments,
            expectedSampleRate: args.expected.sampleRate,
            capturedSegments: args.captured.segments,
            capturedSampleRate: args.captured.sampleRate,
          })
        : null;
    return {
      coverage,
      validity: classifySingleTurnValidity(
        args.latency,
        coverage ?? {
          expectedActiveMs: 0,
          capturedActiveMs: 0,
          coverageRatio: null,
          minimumCoverageRatio: singleTurnMinimumVadCoverageRatio,
        },
        {
          malformedVadInput: args.malformedVadInput,
          captureFailed: args.captureFailed,
        },
      ),
      analysisFailed: false,
    };
  } catch {
    return {
      coverage: null,
      validity: classifySingleTurnValidity(
        args.latency,
        {
          expectedActiveMs: 0,
          capturedActiveMs: 0,
          coverageRatio: null,
          minimumCoverageRatio: singleTurnMinimumVadCoverageRatio,
        },
        { malformedVadInput: true, captureFailed: true },
      ),
      analysisFailed: true,
    };
  }
}

export function calculateSpeechCoverage(args: {
  readonly expectedSegments: readonly SpeechSegment[];
  readonly expectedSampleRate: number;
  readonly capturedSegments: readonly SpeechSegment[];
  readonly capturedSampleRate: number;
}): SpeechCoverage {
  const expectedActiveMs = activeDurationMs(
    args.expectedSegments,
    args.expectedSampleRate,
  );
  const capturedActiveMs = activeDurationMs(
    args.capturedSegments,
    args.capturedSampleRate,
  );
  return {
    expectedActiveMs,
    capturedActiveMs,
    coverageRatio:
      expectedActiveMs === 0 ? null : capturedActiveMs / expectedActiveMs,
    minimumCoverageRatio: singleTurnMinimumVadCoverageRatio,
  };
}

export function classifySingleTurnValidity(
  latency: AudioTimelineMeasurement,
  coverage: SpeechCoverage,
  options: {
    readonly malformedVadInput?: boolean;
    readonly captureFailed?: boolean;
  } = {},
): SingleTurnValidity {
  const reasons: SingleTurnValidityReason[] = [];
  const hasEarlyOrOverlappingAssistant = latency.turns.some(
    (turn) =>
      turn.status === 'unsupported' &&
      (turn.reason ===
        'Assistant audio began before the human command speech ended.' ||
        turn.reason === 'Assistant audio overlapped the human VAD turn.'),
  );
  if (hasEarlyOrOverlappingAssistant)
    reasons.push('assistant-onset-overlapped-human-speech');
  if (
    coverage.coverageRatio === null ||
    !Number.isFinite(coverage.coverageRatio)
  ) {
    reasons.push('vad-coverage-unavailable');
  } else if (coverage.coverageRatio < coverage.minimumCoverageRatio) {
    reasons.push('captured-vad-coverage-below-minimum');
  }
  if (options.malformedVadInput) reasons.push('malformed-vad-input');
  if (options.captureFailed) reasons.push('capture-failed');
  return { valid: reasons.length === 0, reasons };
}

export function suppressInvalidSingleTurnLatency(
  latency: AudioTimelineMeasurement,
  validity: SingleTurnValidity,
): AudioTimelineMeasurement {
  if (validity.valid) return latency;
  return {
    status: 'unsupported',
    t0Sample: null,
    turns: [],
    reason: `Single-turn attempt invalid: ${validity.reasons.join(', ')}`,
  };
}

function activeDurationMs(
  segments: readonly SpeechSegment[],
  sampleRate: number,
): number {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0)
    throw new Error('Speech coverage sample rate must be a positive integer');
  let totalSamples = 0;
  let previousEnd = -1;
  for (const segment of segments) {
    if (
      !Number.isInteger(segment.startSample) ||
      !Number.isInteger(segment.endSample) ||
      segment.startSample < previousEnd ||
      segment.startSample < 0 ||
      segment.endSample <= segment.startSample
    )
      throw new Error('Speech coverage received invalid VAD segments');
    totalSamples += segment.endSample - segment.startSample;
    previousEnd = segment.endSample;
  }
  return (totalSamples * 1_000) / sampleRate;
}
