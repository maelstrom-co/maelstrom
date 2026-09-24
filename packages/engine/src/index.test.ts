import { describe, expect, test } from 'bun:test';
import type { UpdateReason } from '@maelstrom-co/protocol';

import {
  buildActionParameterEnumSnapshot,
  enumSnapshotFor,
  isResizeOnlyBatch,
} from './index.js';
import {
  makeGridRequest,
  makeVessel,
} from './lib/__test-helpers__/fixtures.js';
import {
  makePlanningInput,
  makeStageContext,
} from './lib/__test-helpers__/stage-context.js';

describe('planner helpers on the public surface', () => {
  test('buildActionParameterEnumSnapshot normalizes the enum values of a catalog', () => {
    const vessel = makeVessel({
      id: 'calendar',
      name: 'Calendar',
      description: 'A calendar',
      defaultVariant: 'month',
      variants: {
        month: {
          props: {},
          minSize: { width: 2, height: 2 },
          actions: [
            {
              name: 'showView',
              description: 'Switch the calendar view',
              parameters: [
                {
                  name: 'view',
                  type: 'string',
                  description: 'The view to show',
                  enum: ['day', 'week', 'month'],
                },
              ],
            },
          ],
        },
      },
    });
    const parameter =
      vessel.variants[vessel.defaultVariant]?.actions[0]?.parameters?.[0];
    if (parameter === undefined) throw new Error('fixture needs a parameter');

    const values = buildActionParameterEnumSnapshot([vessel]).get(parameter);

    expect(values.map((value) => value.value)).toEqual([
      'day',
      'week',
      'month',
    ]);
    expect(values.map((value) => value.serialized)).toEqual([
      '"day"',
      '"week"',
      '"month"',
    ]);
    expect(Object.isFrozen(values)).toBe(true);
  });

  test('enumSnapshotFor hands back the context snapshot only for the origin catalog', () => {
    const origin = makePlanningInput(makeGridRequest());
    const ctx = makeStageContext({ origin });

    expect(enumSnapshotFor(ctx, origin.request.vessels)).toBe(ctx.enumSnapshot);
    expect(enumSnapshotFor(ctx, [...origin.request.vessels])).toBeUndefined();
  });

  test('isResizeOnlyBatch is true only for a non-empty batch of resizes', () => {
    const resize: UpdateReason = {
      type: 'chart_resize',
      previous: { columns: 8, rows: 6 },
      current: { columns: 12, rows: 8 },
    };
    const intent: UpdateReason = { type: 'user_intent', intent: 'Add a list' };

    expect(isResizeOnlyBatch([])).toBe(false);
    expect(isResizeOnlyBatch([resize, resize])).toBe(true);
    expect(isResizeOnlyBatch([resize, intent])).toBe(false);
  });
});
