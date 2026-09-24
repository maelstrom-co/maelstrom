import { describe, expect, test } from 'bun:test';
import { isResizeOnlyBatch } from '@maelstrom-co/engine';
import type { UpdateReason } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import { buildUpdateTriggersSection } from './request-serializer.js';

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

describe('resize-only agreement between the prompt and the Engine predicate', () => {
  test('the prompt instruction appears exactly when the predicate says resize-only', () => {
    for (const reasons of batches) {
      const instructed = buildUpdateTriggersSection(reasons).includes(
        'Return an empty executionPlan',
      );
      expect(instructed).toBe(isResizeOnlyBatch(reasons));
    }
  });
});
