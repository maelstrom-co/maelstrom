export const tts2micPlaybackLeadInMs = 3_000;
export const fullScenarioMinimumInterTurnGapMs = 30_000;
export const assistantCompletionQuietIntervalMs = 1_000;
export const fullScenarioPostSpeechBufferMs = 2_000;
export const fullScenarioInterTurnPollIntervalMs = 100;

const assistantQuietBeforeNextInputMs =
  assistantCompletionQuietIntervalMs + fullScenarioPostSpeechBufferMs;

export interface FullScenarioInterTurnGate {
  readonly previousSourceEndMs: number;
  readonly nowMs: () => number;
  readonly silentTailMs: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
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
    throw new Error('Inter-turn schedule values must be finite and nonnegative');

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
    const assistantSilentTailMs = gate.silentTailMs();
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
