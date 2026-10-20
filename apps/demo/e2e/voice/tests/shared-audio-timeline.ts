export type SpeechSegment = {
  readonly startSample: number;
  readonly endSample: number;
};

export type AudioTimelineTurnMeasurement = {
  readonly status: 'measured' | 'unsupported';
  readonly vadStartSample: number;
  readonly vadEndSample: number;
  readonly vadEndOffsetFromT0Samples: number;
  readonly assistantOnsetSample: number | null;
  readonly assistantOnsetOffsetFromT0Samples: number | null;
  readonly latencySamples: number | null;
  readonly latencyMs: number | null;
  readonly reason?: string;
};

export type AudioTimelineMeasurement = {
  readonly status: 'measured' | 'partial' | 'unsupported';
  readonly t0Sample: number | null;
  readonly turns: readonly AudioTimelineTurnMeasurement[];
  readonly reason?: string;
};

export type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';

export const assistantSampleThreshold = 0.01;
export const assistantQuietSamplesAtLeastMs = 10;
export const humanTurnPauseMergeMs = 500;
export const vadThreshold = 0.9;
export const vadPadding = '0s';

type AudioActivity = {
  readonly startSample: number;
  readonly endSample: number;
};

export function singleCommandSpeechEnvelope(
  segments: readonly SpeechSegment[],
): SpeechSegment[] {
  if (segments.length === 0) return [];
  let previousEnd = -1;
  for (const segment of segments) {
    if (
      !Number.isInteger(segment.startSample) ||
      !Number.isInteger(segment.endSample) ||
      segment.startSample < previousEnd ||
      segment.startSample < 0 ||
      segment.endSample <= segment.startSample
    )
      throw new Error('Invalid or unordered raw VAD segments');
    previousEnd = segment.endSample;
  }
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return [];
  return [{ startSample: first.startSample, endSample: last.endSample }];
}

/** One known prerecorded command and its exclusive response-search boundary, in WAV-relative samples. */
export type FixtureSpeechWindow = {
  readonly playbackStartSample: number;
  readonly playbackEndSample: number;
  readonly responseEndSample: number;
  readonly speech: SpeechSegment;
};

/** Groups only wholly contained captured speech; markers bound attribution, never replace VAD endpoints. */
export function fixtureCommandSpeechEnvelopes(
  segments: readonly SpeechSegment[],
  playbackWindows: readonly {
    readonly workletStartFrame: number;
    readonly workletEndFrame: number;
  }[],
  capture: { readonly startFrame: number; readonly endFrame: number },
):
  | {
      readonly status: 'grouped';
      readonly windows: readonly FixtureSpeechWindow[];
    }
  | { readonly status: 'unsupported'; readonly reason: string } {
  const invalidWindows = () => ({
    status: 'unsupported' as const,
    reason:
      'Fixture playback windows are missing, unordered or outside the captured timeline.',
  });
  if (
    !Number.isSafeInteger(capture.startFrame) ||
    !Number.isSafeInteger(capture.endFrame) ||
    capture.startFrame < 0 ||
    capture.endFrame <= capture.startFrame ||
    playbackWindows.length === 0
  )
    return invalidWindows();
  let previousEnd = capture.startFrame;
  for (const window of playbackWindows) {
    if (
      !Number.isSafeInteger(window.workletStartFrame) ||
      !Number.isSafeInteger(window.workletEndFrame) ||
      window.workletStartFrame < previousEnd ||
      window.workletEndFrame <= window.workletStartFrame ||
      window.workletEndFrame > capture.endFrame
    )
      return invalidWindows();
    previousEnd = window.workletEndFrame;
  }
  try {
    singleCommandSpeechEnvelope(segments);
  } catch {
    return {
      status: 'unsupported',
      reason: 'Invalid or overlapping human VAD window.',
    };
  }
  const unassignedSpeech = () => ({
    status: 'unsupported' as const,
    reason: 'Captured human speech is outside its fixture playback window.',
  });
  const windows: FixtureSpeechWindow[] = [];
  let cursor = 0;
  for (const [index, window] of playbackWindows.entries()) {
    const playbackStartSample = window.workletStartFrame - capture.startFrame;
    const playbackEndSample = window.workletEndFrame - capture.startFrame;
    const first = cursor;
    while (cursor < segments.length) {
      const segment = segments[cursor];
      if (!segment || segment.startSample >= playbackEndSample) break;
      if (
        segment.startSample < playbackStartSample ||
        segment.endSample > playbackEndSample
      )
        return unassignedSpeech();
      cursor++;
    }
    const [speech] = singleCommandSpeechEnvelope(segments.slice(first, cursor));
    if (!speech)
      return {
        status: 'unsupported',
        reason: 'No human VAD segments were detected for a fixture playback.',
      };
    windows.push({
      playbackStartSample,
      playbackEndSample,
      responseEndSample:
        (playbackWindows[index + 1]?.workletStartFrame ?? capture.endFrame) -
        capture.startFrame,
      speech,
    });
  }
  if (cursor !== segments.length) return unassignedSpeech();
  return { status: 'grouped', windows };
}

export function mergeHumanSpeechSegments(
  segments: readonly SpeechSegment[],
  sampleRate: number,
  maximumPauseMs = humanTurnPauseMergeMs,
): SpeechSegment[] {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || maximumPauseMs < 0)
    throw new Error('Invalid sample rate or human-turn pause threshold');
  const maximumPauseSamples = Math.round((sampleRate * maximumPauseMs) / 1000);
  const merged: SpeechSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      segment.startSample - previous.endSample <= maximumPauseSamples
    ) {
      merged[merged.length - 1] = {
        startSample: previous.startSample,
        endSample: Math.max(previous.endSample, segment.endSample),
      };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

export function computeAudioTimelineMeasurement(args: {
  readonly inputPcm16: Buffer;
  readonly inputChannels: number;
  readonly assistantPcm16: Buffer;
  readonly assistantChannels: number;
  readonly sampleRate: number;
  readonly speechSegments: readonly SpeechSegment[];
  /** Optional exclusive response limits, no later than the next speech onset or capture end. */
  readonly responseWindowEndSamples?: readonly number[];
  readonly missingBlocks: number;
  readonly rejectAssistantOnsetBeforeSpeechEnd?: boolean;
  readonly assistantThreshold?: number;
  readonly quietSamplesAtLeast?: number;
}): AudioTimelineMeasurement {
  const {
    inputPcm16,
    inputChannels,
    assistantPcm16,
    assistantChannels,
    sampleRate,
    speechSegments,
    responseWindowEndSamples,
    missingBlocks,
    rejectAssistantOnsetBeforeSpeechEnd = false,
    assistantThreshold = assistantSampleThreshold,
    quietSamplesAtLeast = Math.round(
      (sampleRate * assistantQuietSamplesAtLeastMs) / 1000,
    ),
  } = args;
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(inputChannels) ||
    inputChannels < 1 ||
    !Number.isInteger(assistantChannels) ||
    assistantChannels < 1 ||
    inputPcm16.length % (2 * inputChannels) !== 0 ||
    assistantPcm16.length % (2 * assistantChannels) !== 0
  )
    return unsupported('Invalid PCM format or incomplete sample frame.');
  if (missingBlocks > 0)
    return unsupported(
      'The shared AudioWorklet timeline contains missing blocks.',
    );
  if (speechSegments.length === 0)
    return unsupported('No human VAD segments were detected.');

  const inputFrames = inputPcm16.length / (2 * inputChannels);
  const assistantFrames = assistantPcm16.length / (2 * assistantChannels);
  const firstSegment = speechSegments[0];
  if (!firstSegment) return unsupported('No human VAD segments were detected.');
  const t0Sample = firstSegment.startSample;
  if (!Number.isInteger(t0Sample) || t0Sample < 0 || t0Sample >= inputFrames)
    return unsupported(
      'The first human VAD sample is outside the captured input.',
    );
  const assistantActivity = findAssistantActivity(
    assistantPcm16,
    assistantChannels,
    assistantFrames,
    assistantThreshold,
    quietSamplesAtLeast,
  );

  if (
    responseWindowEndSamples &&
    responseWindowEndSamples.length !== speechSegments.length
  )
    return unsupported('Invalid response-search window.');

  const turns = speechSegments.map(
    (segment, index): AudioTimelineTurnMeasurement => {
      const nextSegment = speechSegments[index + 1];
      const windowEnd =
        responseWindowEndSamples === undefined
          ? (nextSegment?.startSample ?? assistantFrames)
          : responseWindowEndSamples[index];
      const common = {
        vadStartSample: segment.startSample,
        vadEndSample: segment.endSample,
        vadEndOffsetFromT0Samples: segment.endSample - t0Sample,
      };
      if (
        !Number.isInteger(segment.startSample) ||
        !Number.isInteger(segment.endSample) ||
        segment.startSample < 0 ||
        segment.endSample <= segment.startSample ||
        segment.endSample > inputFrames ||
        typeof windowEnd !== 'number' ||
        !Number.isSafeInteger(windowEnd) ||
        windowEnd > assistantFrames ||
        windowEnd > (nextSegment?.startSample ?? assistantFrames) ||
        windowEnd <= segment.endSample
      )
        return unsupportedTurn(
          common,
          'Invalid or overlapping human VAD window.',
        );

      if (
        rejectAssistantOnsetBeforeSpeechEnd &&
        assistantActivity.some(
          (activity) => activity.startSample < segment.endSample,
        )
      )
        return unsupportedTurn(
          common,
          'Assistant audio began before the human command speech ended.',
        );

      const overlap = assistantActivity.find(
        (activity) =>
          activity.startSample < segment.endSample &&
          activity.endSample > segment.startSample,
      );
      if (overlap) {
        return unsupportedTurn(
          common,
          'Assistant audio overlapped the human VAD turn.',
        );
      }

      const candidate = assistantActivity.find(
        (activity) =>
          activity.startSample >= segment.endSample &&
          activity.startSample < windowEnd,
      );
      if (!candidate) {
        return unsupportedTurn(
          common,
          responseWindowEndSamples
            ? 'No assistant onset occurred before the next fixture playback or capture end.'
            : 'No assistant onset occurred before the next human VAD turn or capture end.',
        );
      }
      if (candidate.endSample > windowEnd) {
        return unsupportedTurn(
          common,
          responseWindowEndSamples
            ? 'Assistant audio overlaps the next fixture playback.'
            : 'Assistant audio overlaps the next human VAD turn.',
        );
      }
      const latencySamples = candidate.startSample - segment.endSample;
      return {
        status: 'measured',
        ...common,
        assistantOnsetSample: candidate.startSample,
        assistantOnsetOffsetFromT0Samples: candidate.startSample - t0Sample,
        latencySamples,
        latencyMs: (latencySamples * 1000) / sampleRate,
      };
    },
  );
  const supportedCount = turns.filter(
    (turn) => turn.status === 'measured',
  ).length;
  const status =
    supportedCount === 0
      ? 'unsupported'
      : supportedCount === turns.length
        ? 'measured'
        : 'partial';
  return {
    status,
    t0Sample,
    turns,
    ...(status === 'unsupported'
      ? {
          reason:
            'No unambiguous assistant onset was associated with a human VAD turn.',
        }
      : {}),
  };
}

function findAssistantActivity(
  pcm: Buffer,
  channels: number,
  frames: number,
  threshold: number,
  quietSamplesAtLeast: number,
): AudioActivity[] {
  const result: AudioActivity[] = [];
  let activeStart: number | undefined;
  let belowThresholdStart: number | undefined;
  for (let frame = 0; frame < frames; frame++) {
    let active = false;
    for (let channel = 0; channel < channels; channel++) {
      const value = pcm.readInt16LE((frame * channels + channel) * 2) / 32768;
      if (Math.abs(value) >= threshold) {
        active = true;
        break;
      }
    }
    if (active) {
      activeStart ??= frame;
      belowThresholdStart = undefined;
    } else if (activeStart !== undefined) {
      belowThresholdStart ??= frame;
      if (frame - belowThresholdStart >= quietSamplesAtLeast) {
        result.push({
          startSample: activeStart,
          endSample: belowThresholdStart,
        });
        activeStart = undefined;
        belowThresholdStart = undefined;
      }
    }
  }
  if (activeStart !== undefined)
    result.push({
      startSample: activeStart,
      endSample: belowThresholdStart ?? frames,
    });
  return result;
}

function unsupportedTurn(
  turn: Pick<
    AudioTimelineTurnMeasurement,
    'vadStartSample' | 'vadEndSample' | 'vadEndOffsetFromT0Samples'
  >,
  reason: string,
): AudioTimelineTurnMeasurement {
  return {
    status: 'unsupported',
    ...turn,
    assistantOnsetSample: null,
    assistantOnsetOffsetFromT0Samples: null,
    latencySamples: null,
    latencyMs: null,
    reason,
  };
}

function unsupported(reason: string): AudioTimelineMeasurement {
  return { status: 'unsupported', t0Sample: null, turns: [], reason };
}
