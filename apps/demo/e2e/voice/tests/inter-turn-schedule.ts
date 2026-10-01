export const tts2micPlaybackLeadInMs = 3_000;
export const fullScenarioMinimumInterTurnGapMs = 30_000;
export const assistantCompletionQuietIntervalMs = 1_000;
export const fullScenarioPostSpeechBufferMs = 2_000;
export const fullScenarioInterTurnPollIntervalMs = 100;
export const fullScenarioLeadInPollIntervalMs = 20;

const assistantQuietBeforeNextInputMs =
  assistantCompletionQuietIntervalMs + fullScenarioPostSpeechBufferMs;

export interface FullScenarioInterTurnGate {
  readonly previousSourceEndMs: number;
  readonly nowMs: () => number;
  readonly silentTailMs: () => number | Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export async function monitorFullScenarioLeadIn(args: {
  readonly playbackStartedAtMs: number;
  readonly nowMs: () => number;
  readonly assistantSilentTailMs: () => number | Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly stopAndWait: () => Promise<{
    readonly terminated: boolean;
    readonly closedAtMs: number;
    readonly sourceNotStarted: boolean;
  }>;
}): Promise<'source-onset' | 'cancelled-before-source'> {
  const sourceOnsetDeadlineMs =
    args.playbackStartedAtMs + tts2micPlaybackLeadInMs;
  if (
    !Number.isFinite(args.playbackStartedAtMs) ||
    !Number.isFinite(sourceOnsetDeadlineMs)
  )
    throw new Error('Playback lead-in deadline must be finite');

  while (true) {
    const nowMs = args.nowMs();
    const assistantSilentTailMs = await args.assistantSilentTailMs();
    if (assistantSilentTailMs < assistantQuietBeforeNextInputMs) {
      const stopped = await args.stopAndWait();
      if (
        !stopped.terminated ||
        !Number.isFinite(stopped.closedAtMs) ||
        stopped.closedAtMs < args.playbackStartedAtMs
      )
        throw new Error('Player termination was not confirmed');
      if (!stopped.sourceNotStarted)
        throw new Error(
          'Assistant output resumed during the playback lead-in; source onset is unverified, so this attempt is invalidated without replay',
        );
      return 'cancelled-before-source';
    }
    if (nowMs >= sourceOnsetDeadlineMs) return 'source-onset';
    await args.sleep(
      Math.min(fullScenarioLeadInPollIntervalMs, sourceOnsetDeadlineMs - nowMs),
    );
  }
}

export async function waitForAssistantResponseCompletion(args: {
  readonly activity: () =>
    | { readonly activeMs: number; readonly silentTailMs: number }
    | Promise<{ readonly activeMs: number; readonly silentTailMs: number }>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly quietMs?: number;
}): Promise<void> {
  const quietMs = args.quietMs ?? assistantCompletionQuietIntervalMs;
  if (!Number.isFinite(quietMs) || quietMs <= 0)
    throw new Error('Assistant completion quiet interval must be positive');
  let sawAssistantOutput = false;
  while (true) {
    const current = await args.activity();
    sawAssistantOutput ||= current.activeMs >= 150;
    if (sawAssistantOutput && current.silentTailMs >= quietMs) return;
    await args.sleep(fullScenarioInterTurnPollIntervalMs);
  }
}

export function canStartNextFullScenarioInput(args: {
  readonly previousSourceEndMs: number;
  readonly nowMs: number;
  readonly assistantSilentTailMs: number;
}): boolean {
  const { previousSourceEndMs, nowMs, assistantSilentTailMs } = args;
  if (
    !Number.isFinite(previousSourceEndMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(assistantSilentTailMs) ||
    assistantSilentTailMs < 0
  )
    throw new Error(
      'Inter-turn schedule values must be finite and nonnegative',
    );

  const nextCommandStartDeadlineMs =
    previousSourceEndMs +
    fullScenarioMinimumInterTurnGapMs -
    tts2micPlaybackLeadInMs;
  if (!Number.isFinite(nextCommandStartDeadlineMs))
    throw new Error('Inter-turn schedule deadline must be finite');

  return (
    nowMs >= nextCommandStartDeadlineMs &&
    assistantSilentTailMs >= assistantQuietBeforeNextInputMs
  );
}

export async function waitForNextFullScenarioInput(
  gate: FullScenarioInterTurnGate,
): Promise<void> {
  if (!Number.isFinite(gate.previousSourceEndMs))
    throw new Error('Previous source end timestamp must be finite');

  while (true) {
    const nowMs = gate.nowMs();
    const assistantSilentTailMs = await gate.silentTailMs();
    if (
      canStartNextFullScenarioInput({
        previousSourceEndMs: gate.previousSourceEndMs,
        nowMs,
        assistantSilentTailMs,
      })
    )
      return;

    const commandDeadlineMs =
      gate.previousSourceEndMs +
      fullScenarioMinimumInterTurnGapMs -
      tts2micPlaybackLeadInMs;
    const spacingWaitMs = Math.max(0, commandDeadlineMs - nowMs);
    const silenceWaitMs = Math.max(
      0,
      assistantQuietBeforeNextInputMs - assistantSilentTailMs,
    );
    const waitMs = Math.min(
      fullScenarioInterTurnPollIntervalMs,
      Math.max(spacingWaitMs, silenceWaitMs),
    );
    await gate.sleep(waitMs);
  }
}
