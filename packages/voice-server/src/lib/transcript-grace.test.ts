import { describe, expect, test } from 'bun:test';

import { handleTranscriptGraceExpiryTerminalBranches } from './transcript-grace.js';

describe('transcript-grace', () => {
  test('finalizes accumulated transcript on grace expiry', () => {
    const finalizedTexts: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const clearedPendingFinalization: boolean[] = [];

    const handled = handleTranscriptGraceExpiryTerminalBranches(
      {
        currentTranscript: '',
        accumulatedTranscript: 'late arrival',
        hasEmittedFinal: false,
      },
      (event, details) => {
        traceEvents.push({ event, details });
      },
      () => {
        clearedPendingFinalization.push(true);
      },
      (text) => {
        finalizedTexts.push(text);
        return { emitted: true, startedProcessing: true };
      },
    );

    expect(handled).toBe(true);
    expect(clearedPendingFinalization).toEqual([true]);
    expect(finalizedTexts).toEqual(['late arrival']);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.completed_with_late_transcript',
        details: expect.objectContaining({
          textLength: 'late arrival'.length,
          usedAccumulatedTranscriptFallback: true,
        }),
      }),
    );
  });

  test('short-circuits when grace expiry already finalized elsewhere', () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const finalizedTexts: string[] = [];
    const clearedPendingFinalization: boolean[] = [];

    const handled = handleTranscriptGraceExpiryTerminalBranches(
      {
        currentTranscript: 'provider final',
        accumulatedTranscript: 'provider final',
        hasEmittedFinal: true,
      },
      (event, details) => {
        traceEvents.push({ event, details });
      },
      () => {
        clearedPendingFinalization.push(true);
      },
      (text) => {
        finalizedTexts.push(text);
        return { emitted: true, startedProcessing: true };
      },
    );

    expect(handled).toBe(true);
    expect(finalizedTexts).toEqual([]);
    expect(clearedPendingFinalization).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.already_finalized',
        details: expect.objectContaining({
          currentTranscriptLength: 'provider final'.length,
          accumulatedTranscriptLength: 'provider final'.length,
        }),
      }),
    );
  });
});
