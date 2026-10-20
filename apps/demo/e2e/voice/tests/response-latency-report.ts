import { readCiMetric } from '../ci-metrics.ts';
import type { AudioTimelineMeasurement } from './shared-audio-timeline.ts';

/** Bounded diagnostic codes, never capture payloads or provider error text. */
export type ResponseLatencyFailure =
  | 'scenario-failed'
  | 'latency-unmeasured'
  | 'no-measured-turns'
  | 'invalid-latency'
  | 'invalid-pcm'
  | 'capture-failed'
  | 'capture-misaligned'
  | 'capture-incomplete'
  | 'vad-invalid'
  | 'vad-clock-mismatch'
  | 'no-human-speech'
  | 'invalid-human-window'
  | 'fixture-window-invalid'
  | 'fixture-speech-missing'
  | 'fixture-speech-unassigned'
  | 'assistant-overlap'
  | 'assistant-onset-missing';

/** Full-scenario validity; a partially measured population is not a passing lane. */
export type ResponseLatencyAssessment = {
  /** A passed run has a nonempty, fully measured latency population. */
  readonly status: 'passed' | 'failed';
  /** Deduplicated, allowlisted causes of invalidation. */
  readonly reasons: readonly ResponseLatencyFailure[];
};

const knownReasons = new Map<string, ResponseLatencyFailure>([
  ['Invalid PCM format or incomplete sample frame.', 'invalid-pcm'],
  ['Shared audio capture or VAD failed.', 'capture-failed'],
  ['Shared browser audio timeline was not captured.', 'capture-failed'],
  [
    'AudioWorklet capture frame counts did not validate against its shared currentFrame timeline.',
    'capture-misaligned',
  ],
  [
    'The shared AudioWorklet timeline contains missing blocks.',
    'capture-incomplete',
  ],
  ['Captured VAD data failed validation.', 'vad-invalid'],
  [
    'VAD returned offsets in a format other than the captured source sample clock.',
    'vad-clock-mismatch',
  ],
  ['No human VAD segments were detected.', 'no-human-speech'],
  [
    'The first human VAD sample is outside the captured input.',
    'invalid-human-window',
  ],
  ['Invalid or overlapping human VAD window.', 'invalid-human-window'],
  ['Invalid response-search window.', 'fixture-window-invalid'],
  [
    'Fixture playback windows are missing, unordered or outside the captured timeline.',
    'fixture-window-invalid',
  ],
  [
    'No human VAD segments were detected for a fixture playback.',
    'fixture-speech-missing',
  ],
  [
    'Captured human speech is outside its fixture playback window.',
    'fixture-speech-unassigned',
  ],
  ['Assistant audio overlaps the next fixture playback.', 'assistant-overlap'],
  [
    'No assistant onset occurred before the next fixture playback or capture end.',
    'assistant-onset-missing',
  ],
  ['Assistant audio overlapped the human VAD turn.', 'assistant-overlap'],
  ['Assistant audio overlaps the next human VAD turn.', 'assistant-overlap'],
  [
    'Assistant audio began before the human command speech ended.',
    'assistant-overlap',
  ],
  [
    'No assistant onset occurred before the next human VAD turn or capture end.',
    'assistant-onset-missing',
  ],
]);

function failureCode(reason: string | undefined): ResponseLatencyFailure {
  if (
    /^AudioWorklet reported \d+ missing or format-changing blocks\.$/.test(
      reason ?? '',
    )
  )
    return 'capture-incomplete';
  return knownReasons.get(reason ?? '') ?? 'latency-unmeasured';
}

/** Applies the CI lane's existing completeness and scalar requirements to the producing test. */
export function assessResponseLatencyRun(
  latency: AudioTimelineMeasurement,
  executionFailed = false,
): ResponseLatencyAssessment {
  const reasons = new Set<ResponseLatencyFailure>();
  if (executionFailed) reasons.add('scenario-failed');
  if (latency.status !== 'measured') reasons.add(failureCode(latency.reason));
  if (latency.turns.length === 0) reasons.add('no-measured-turns');
  for (const turn of latency.turns) {
    if (turn.status !== 'measured') {
      reasons.add(failureCode(turn.reason));
      continue;
    }
    try {
      readCiMetric({ p95Ms: turn.latencyMs, samples: 1 });
    } catch {
      reasons.add('invalid-latency');
    }
  }
  return {
    status: reasons.size === 0 ? 'passed' : 'failed',
    reasons: [...reasons],
  };
}

/** Attaches evidence before failing an unmeasured full-scenario run. */
export async function completeResponseLatencyReport<T>(
  report: T,
  assessment: ResponseLatencyAssessment,
  attach: (report: T) => Promise<unknown>,
): Promise<void> {
  await attach(report);
  if (assessment.status !== 'passed')
    throw new Error(
      `Full-scenario response latency invalid: ${assessment.reasons.join(', ')}`,
    );
}
