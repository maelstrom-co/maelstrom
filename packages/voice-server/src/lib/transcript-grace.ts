export function handleTranscriptGraceExpiryTerminalBranches(
  runtimeState: {
    currentTranscript: string;
    accumulatedTranscript: string;
    hasEmittedFinal: boolean;
  },
  trace: (event: string, details?: Record<string, unknown>) => void,
  clearPendingFinalizationForGracePath: () => void,
  finalizeTranscript: (text: string) => {
    emitted: boolean;
    startedProcessing: boolean;
  },
): boolean {
  if (runtimeState.hasEmittedFinal) {
    trace('stt.transcript_grace.already_finalized', {
      currentTranscriptLength: runtimeState.currentTranscript.length,
      accumulatedTranscriptLength: runtimeState.accumulatedTranscript.length,
    });

    return true;
  }

  const transcriptToFinalize =
    runtimeState.currentTranscript || runtimeState.accumulatedTranscript;

  if (!transcriptToFinalize) {
    return false;
  }

  clearPendingFinalizationForGracePath();
  trace('stt.transcript_grace.completed_with_late_transcript', {
    textLength: transcriptToFinalize.length,
    usedAccumulatedTranscriptFallback:
      !runtimeState.currentTranscript &&
      Boolean(runtimeState.accumulatedTranscript),
  });
  finalizeTranscript(transcriptToFinalize);

  return true;
}
