import { describe, expect, test } from 'bun:test';

import type { RunRecord } from '../../core/run.js';
import { nothingToFill } from './record.js';

const completion = { stage: 'llmComplete', ms: 1, outcome: 'ok' } as const;
const completeCall = {
  role: 'complete',
  model: 'test-model',
  latencyMs: 30,
  completed: true,
} as const;

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    scenarioId: 's',
    suite: 'development',
    arm: 'jev-poc',
    kind: 'jev-poc',
    repeat: 1,
    turnMs: 100,
    expectedDeferral: false,
    arrangementRules: false,
    skipReply: true,
    stages: [{ stage: 'jevSelect', ms: 1, outcome: 'ok' }, completion],
    ...overrides,
  };
}

describe('nothingToFill', () => {
  test('is true for a loop-driven turn whose completion stage made no completion call', () => {
    expect(
      nothingToFill(
        record({
          llmCalls: [
            {
              role: 'fallback',
              model: 'test-model',
              latencyMs: 20,
              completed: true,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test('is false for a loop-driven turn whose completion stage made a call', () => {
    expect(nothingToFill(record({ llmCalls: [completeCall] }))).toBe(false);
  });

  test('reads the composed-pairs arm, whose completion stage records under the same name', () => {
    const composed = {
      arm: 'jev-composed-pairs-screen-scope',
      kind: 'jev',
      stages: [
        { stage: 'jevSelect', ms: 1, outcome: 'ok' },
        { stage: 'jevActions', ms: 1, outcome: 'ok' },
        { stage: 'jevLayout', ms: 1, outcome: 'ok' },
        completion,
      ],
    } as const;
    expect(nothingToFill(record(composed))).toBe(true);
    expect(
      nothingToFill(record({ ...composed, llmCalls: [completeCall] })),
    ).toBe(false);
  });

  test('leaves out a turn whose completion stage ended in error', () => {
    expect(
      nothingToFill(
        record({
          stages: [
            { ...completion, outcome: 'error', errorTag: 'ValidationError' },
          ],
        }),
      ),
    ).toBe(undefined);
  });

  test('leaves out a turn without skipReply', () => {
    const { skipReply: _skipReply, ...loopless } = record({});
    expect(nothingToFill(loopless as RunRecord)).toBe(undefined);
  });

  test('leaves out a turn that never ran the completion stage live', () => {
    expect(
      nothingToFill(
        record({
          stages: [{ stage: 'jevSelect', ms: 1, outcome: 'deferred' }],
        }),
      ),
    ).toBe(undefined);
    expect(
      nothingToFill(record({ stages: [{ ...completion, replayed: true }] })),
    ).toBe(undefined);
  });
});
