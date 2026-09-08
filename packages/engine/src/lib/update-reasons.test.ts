import { describe, expect, test } from 'bun:test';
import type { ChartRequest, UpdateReason } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';
import { buildUpdateTriggersSection } from './prompt/request-serializer.js';
import { classifyExecutionTurn } from './response/execution-plan/turn.js';
import { isResizeOnlyBatch } from './update-reasons.js';

const resize: UpdateReason = {
  type: 'chart_resize',
  previous: { columns: 8, rows: 6 },
  current: { columns: 12, rows: 8 },
};
const intent: UpdateReason = {
  type: 'user_intent',
  intent: 'Add a task list',
};
const mutation: UpdateReason = {
  type: 'vessel_mutation',
  instanceId: InstanceId('calendar-main'),
  changes: 'date range updated',
};

const batches: ReadonlyArray<readonly UpdateReason[]> = [
  [],
  [resize],
  [resize, resize],
  [intent],
  [mutation],
  [resize, intent],
  [resize, mutation],
  [intent, mutation],
];

function requestWith(updateReasons: readonly UpdateReason[]): ChartRequest {
  return {
    type: 'chart_request',
    context: {
      updateReasons,
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'grid',
    },
    instances: [],
    vessels: [],
    layout: { type: 'grid', positions: [] },
  };
}

describe('isResizeOnlyBatch', () => {
  test('is false for an empty reason list', () => {
    expect(isResizeOnlyBatch([])).toBe(false);
  });

  test('is true only when every reason is a resize', () => {
    expect(isResizeOnlyBatch([resize])).toBe(true);
    expect(isResizeOnlyBatch([resize, resize])).toBe(true);
    expect(isResizeOnlyBatch([resize, intent])).toBe(false);
    expect(isResizeOnlyBatch([resize, mutation])).toBe(false);
    expect(isResizeOnlyBatch([intent])).toBe(false);
  });
});

describe('resize-only agreement between prompt and execution turn', () => {
  test('the prompt instruction appears exactly when the guard arms', () => {
    for (const reasons of batches) {
      const armed =
        classifyExecutionTurn(requestWith(reasons)).kind === 'resize_only';
      const instructed = buildUpdateTriggersSection(reasons).includes(
        'Return an empty executionPlan',
      );
      expect(instructed).toBe(armed);
    }
  });
});
