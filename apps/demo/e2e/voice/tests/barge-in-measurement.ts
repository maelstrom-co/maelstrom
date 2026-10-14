import type { BargeInPlaybackEvent } from './barge-in-observer.ts';
import { assistantSampleThreshold } from './shared-audio-timeline.ts';

export const bargeInPolicy = {
  assistantThreshold: assistantSampleThreshold,
  quietConfirmationMs: 300,
  maximumStopLatencyMs: 2_000,
  resumeGuardMs: 500,
  preOnsetActivityMs: 100,
  maximumPreOnsetQuietMs: 30,
  cancellationGraceMs: 250,
} as const;

export type BargeInMeasurement = {
  readonly status: 'measured' | 'invalid' | 'ambiguous' | 'timeout' | 'failed';
  readonly humanOnsetSample: number | null;
  readonly assistantStopSample: number | null;
  readonly latencyMs: number | null;
  readonly reason: string | null;
};

export function invalidBargeIn(
  reason: string,
  humanOnsetSample: number | null = null,
): BargeInMeasurement {
  return {
    status: 'invalid',
    humanOnsetSample:
      humanOnsetSample !== null &&
      Number.isSafeInteger(humanOnsetSample) &&
      humanOnsetSample >= 0
        ? humanOnsetSample
        : null,
    assistantStopSample: null,
    latencyMs: null,
    reason,
  };
}

export function computeBargeInMeasurement(args: {
  readonly assistantPcm16: Buffer;
  readonly assistantChannels: number;
  readonly sampleRate: number;
  readonly humanOnsetSample: number;
  readonly missingBlocks: number;
  readonly targetResponseId: string | null;
  readonly events: readonly BargeInPlaybackEvent[];
  readonly droppedEvents: number;
  readonly greetingPlayback?: {
    readonly sourceCount: number;
    readonly failure: string | null;
    readonly stoppedAtSample: number | null;
    readonly stoppedEarly: boolean;
  };
}): BargeInMeasurement {
  const {
    assistantPcm16: pcm,
    assistantChannels: channels,
    sampleRate,
    humanOnsetSample: onset,
    missingBlocks,
    targetResponseId,
    events,
    droppedEvents,
    greetingPlayback,
  } = args;
  if (
    greetingPlayback &&
    (greetingPlayback.sourceCount !== 1 || greetingPlayback.failure !== null)
  )
    return invalidBargeIn(
      'Greeting source capture was unavailable or ambiguous.',
      onset,
    );
  if (
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    pcm.length % (2 * channels) !== 0 ||
    !Number.isSafeInteger(onset) ||
    onset < 0
  )
    return invalidBargeIn('Invalid PCM format or speech-onset sample.', onset);
  if (missingBlocks !== 0 || droppedEvents !== 0)
    return invalidBargeIn(
      'Incomplete shared-clock capture or playback evidence.',
      onset,
    );
  const frames = pcm.length / (2 * channels);
  const samples = (ms: number) => Math.ceil((sampleRate * ms) / 1000);
  const active = (frame: number) => {
    for (let channel = 0; channel < channels; channel++)
      if (
        Math.abs(pcm.readInt16LE((frame * channels + channel) * 2) / 32768) >=
        bargeInPolicy.assistantThreshold
      )
        return true;
    return false;
  };
  const preWindow = samples(bargeInPolicy.preOnsetActivityMs);
  if (onset < preWindow || onset >= frames)
    return invalidBargeIn(
      'Speech onset lacks a captured assistant pre-window.',
      onset,
    );
  let priorActiveFrames = 0;
  let lastActive = -1;
  for (let frame = onset - preWindow; frame < onset; frame++)
    if (active(frame)) {
      priorActiveFrames++;
      lastActive = frame;
    }
  if (
    priorActiveFrames < samples(10) ||
    onset - lastActive > samples(bargeInPolicy.maximumPreOnsetQuietMs)
  )
    return invalidBargeIn(
      'Assistant was not speaking at interruption onset.',
      onset,
    );

  const quietFrames = samples(bargeInPolicy.quietConfirmationMs);
  const deadline = onset + samples(bargeInPolicy.maximumStopLatencyMs);
  const competingOutput = greetingPlayback
    ? []
    : events.filter(
        (event) =>
          event.type === 'output_audio_buffer.started' &&
          event.frame >= onset &&
          (event.responseId === null || event.responseId !== targetResponseId),
      );
  const result = (
    status: BargeInMeasurement['status'],
    stop: number | null,
    reason: string | null,
  ): BargeInMeasurement => ({
    status,
    humanOnsetSample: onset,
    assistantStopSample: stop,
    latencyMs:
      status === 'measured' && stop !== null
        ? ((stop - onset) * 1000) / sampleRate
        : null,
    reason,
  });
  let quietStart: number | null =
    lastActive < onset - 1 ? lastActive + 1 : null;
  let stop: number | null = null;
  for (
    let frame = onset;
    frame < Math.min(frames, deadline + quietFrames);
    frame++
  ) {
    if (active(frame)) quietStart = null;
    else {
      quietStart ??= frame;
      if (frame - quietStart + 1 >= quietFrames) {
        stop = quietStart;
        break;
      }
    }
  }
  if (stop !== null && stop < onset)
    return result(
      'invalid',
      stop,
      'Confirmed assistant silence began before the interruption.',
    );
  if (stop === null || stop > deadline) {
    if (frames < deadline + quietFrames)
      return result(
        'invalid',
        null,
        'Observation ended before a stop could be confirmed.',
      );
    if (competingOutput.some((event) => event.frame < deadline + quietFrames))
      return result(
        'ambiguous',
        null,
        'New or unidentified output prevents attribution of continued audio.',
      );
    return result(
      'timeout',
      null,
      'Assistant did not stop within the observation horizon.',
    );
  }
  const guardEnd = stop + quietFrames + samples(bargeInPolicy.resumeGuardMs);
  if (frames < guardEnd)
    return result(
      'invalid',
      stop,
      'Capture ended before the output-resumption guard completed.',
    );
  if (competingOutput.some((event) => event.frame <= stop + quietFrames))
    return result(
      'ambiguous',
      stop,
      'New or unidentified output prevents attribution of the silence boundary.',
    );
  const corroborated = greetingPlayback
    ? greetingPlayback.stoppedEarly &&
      greetingPlayback.stoppedAtSample !== null &&
      greetingPlayback.stoppedAtSample >= onset &&
      greetingPlayback.stoppedAtSample <=
        stop + quietFrames + samples(bargeInPolicy.cancellationGraceMs)
    : targetResponseId !== null &&
      events.some(
        (event) =>
          event.responseId === targetResponseId &&
          event.frame >= onset &&
          event.frame <=
            stop + quietFrames + samples(bargeInPolicy.cancellationGraceMs) &&
          (event.type === 'output_audio_buffer.cleared' ||
            (event.type === 'response.done' && event.status === 'cancelled')),
      );
  if (!corroborated)
    return result(
      'ambiguous',
      stop,
      'Output became quiet without matching interruption evidence; natural completion cannot be excluded.',
    );
  for (let frame = stop + quietFrames; frame < guardEnd; frame++)
    if (active(frame))
      return competingOutput.length > 0
        ? result(
            'ambiguous',
            stop,
            'Resumed audio may belong to new or unidentified output; lifecycle receipt times do not label PCM.',
          )
        : result(
            'failed',
            stop,
            'Interrupted assistant output resumed after confirmed silence.',
          );
  return result('measured', stop, null);
}

export function summarizeBargeIn(measurements: readonly BargeInMeasurement[]) {
  const counts = {
    measured: 0,
    invalid: 0,
    ambiguous: 0,
    timeout: 0,
    failed: 0,
  };
  for (const measurement of measurements) counts[measurement.status]++;
  const values = measurements
    .filter((measurement) => measurement.status === 'measured')
    .map((measurement) => measurement.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const center = values[middle];
  const validAttempts = counts.measured + counts.timeout + counts.failed;
  return {
    attemptCount: measurements.length,
    counts,
    validAttemptCount: validAttempts,
    failureRate:
      validAttempts === 0
        ? null
        : (counts.timeout + counts.failed) / validAttempts,
    latencyMs: {
      sampleCount: values.length,
      median:
        center === undefined
          ? null
          : values.length % 2
            ? center
            : ((values[middle - 1] ?? center) + center) / 2,
      p95: values[Math.ceil(values.length * 0.95) - 1] ?? null,
      population: 'successfully measured stops only',
    },
  };
}
