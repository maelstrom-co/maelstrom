import { describe, expect, test } from 'bun:test';
import type { GridResponse } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import { makeGridRequest } from '../../__test-helpers__/fixtures.js';
import { healGridLayout } from './grid-layout.js';

function makeGridResponse(overrides: Partial<GridResponse> = {}): GridResponse {
  return {
    userMessage: 'ok',
    rationale: 'placing calendar',
    executionPlan: [],
    layout: {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 4, height: 4 },
        },
      ],
    },
    ...overrides,
  };
}

describe('healGridLayout', () => {
  test('healthy response heals to itself with no drops or warnings', () => {
    const response = makeGridResponse();
    const healed = healGridLayout(response, makeGridRequest());

    expect(healed.layout.positions).toHaveLength(1);
    expect(healed.layout.positions[0]).toBe(response.layout.positions[0]);
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.warnings).toEqual([]);
  });

  test('empty rationale produces a missing_rationale warning, layout intact', () => {
    const healed = healGridLayout(
      makeGridResponse({ rationale: '   ' }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toHaveLength(1);
    expect(healed.warnings).toEqual([{ kind: 'missing_rationale' }]);
    expect(healed.droppedEntries).toEqual([]);
  });

  test('duplicate instanceId: keep first, drop subsequent', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 0 },
              size: { width: 4, height: 4 },
            },
            {
              instanceId: 'calendar-main',
              position: { row: 4, column: 0 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toHaveLength(1);
    expect(healed.layout.positions[0]?.position).toEqual({ row: 0, column: 0 });
    expect(healed.droppedEntries).toEqual([
      { reason: 'duplicate_instance_id', instanceId: InstanceId('calendar-main') },
    ]);
  });

  test('position_overflow: drop the position', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 6, column: 10 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toEqual([
      {
        reason: 'position_overflow',
        instanceId: InstanceId('calendar-main'),
        row: 6,
        column: 10,
        width: 4,
        height: 4,
        chartColumns: 12,
        chartRows: 8,
      },
    ]);
  });

  test('size_below_minimum: drop the position', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 0 },
              size: { width: 2, height: 2 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toEqual([
      {
        reason: 'size_below_minimum',
        instanceId: InstanceId('calendar-main'),
        width: 2,
        height: 2,
        minWidth: 4,
        minHeight: 4,
      },
    ]);
  });

  test('unknown_vessel: drop the position', () => {
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'ghost-vessel',
          variant: 'month',
        },
      ],
    });
    const healed = healGridLayout(makeGridResponse(), request);

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toEqual([
      {
        reason: 'unknown_vessel',
        instanceId: InstanceId('calendar-main'),
        vesselId: 'ghost-vessel',
      },
    ]);
  });

  test('unknown_variant: drop the position', () => {
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'nonexistent',
        },
      ],
    });
    const healed = healGridLayout(makeGridResponse(), request);

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toEqual([
      {
        reason: 'unknown_variant',
        instanceId: InstanceId('calendar-main'),
        variant: 'nonexistent',
      },
    ]);
  });

  test('unknown_instance: drop the position', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'not-in-request',
              position: { row: 0, column: 0 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toContainEqual({
      reason: 'unknown_instance',
      instanceId: InstanceId('not-in-request'),
    });
  });

  test('mixed: valid + invalid positions — keep valid, drop the rest', () => {
    // Two instances configured on the request; one position is valid, one
    // overflows. The healed layout retains the valid one only.
    const request = makeGridRequest({
      instances: [
        { instanceId: InstanceId('calendar-main'), vesselId: 'calendar', variant: 'month' },
        { instanceId: InstanceId('extra'), vesselId: 'calendar', variant: 'month' },
      ],
    });
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 0 },
              size: { width: 4, height: 4 },
            },
            {
              instanceId: 'extra',
              position: { row: 6, column: 10 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      request,
    );

    expect(healed.layout.positions).toHaveLength(1);
    expect(healed.layout.positions[0]?.instanceId).toBe('calendar-main');
    expect(healed.droppedEntries).toHaveLength(1);
    expect(healed.droppedEntries[0]?.reason).toBe('position_overflow');
  });

  test('compound: warning + per-position issues; each drop names its own real problem', () => {
    // Each position is reported with the specific issue that excluded it.
    // `duplicate_instance_id` is NOT reported when the first occurrence was
    // also dropped — that drop already names a real problem, and adding a
    // duplicate flag would obscure the actual fix the LLM needs to make.
    const healed = healGridLayout(
      makeGridResponse({
        rationale: '',
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 0 },
              size: { width: 2, height: 2 },
            },
            {
              instanceId: 'calendar-main',
              position: { row: 10, column: 10 },
              size: { width: 5, height: 5 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.warnings).toEqual([{ kind: 'missing_rationale' }]);
    const reasons = healed.droppedEntries.map((d) => d.reason);
    expect(reasons).toContain('size_below_minimum');
    expect(reasons).toContain('position_overflow');
    expect(reasons).not.toContain('duplicate_instance_id');
    expect(healed.layout.positions).toEqual([]);
  });

  test('position at the exact edge of chart dimensions is valid', () => {
    // chartDimensions: 12 cols, 8 rows; position (4, 8) size 4x4 ends at (8, 12) — exactly the edges
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 4, column: 8 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );

    expect(healed.layout.positions).toHaveLength(1);
    expect(healed.droppedEntries).toEqual([]);
  });

  test('one position with multiple issues produces multiple drops, position dropped once', () => {
    // The position both overflows AND references an unknown vessel; both
    // issues are recorded but the position is dropped a single time.
    // Pins the contract — a future refactor that short-circuits on first
    // detected issue would lose the second drop entry.
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('bad'),
          vesselId: 'no-such-vessel',
          variant: 'whatever',
        },
      ],
    });
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'bad',
              position: { row: 6, column: 10 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      request,
    );

    expect(healed.layout.positions).toEqual([]);
    expect(healed.droppedEntries).toHaveLength(2);
    const reasons = healed.droppedEntries.map((d) => d.reason).sort();
    expect(reasons).toEqual(['position_overflow', 'unknown_vessel']);
  });

  test('position_overflow fires on +1 width overflow (boundary off-by-one)', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 0, column: 9 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );
    expect(healed.droppedEntries[0]?.reason).toBe('position_overflow');
  });

  test('position_overflow fires on +1 height overflow (boundary off-by-one)', () => {
    const healed = healGridLayout(
      makeGridResponse({
        layout: {
          positions: [
            {
              instanceId: 'calendar-main',
              position: { row: 5, column: 0 },
              size: { width: 4, height: 4 },
            },
          ],
        },
      }),
      makeGridRequest(),
    );
    expect(healed.droppedEntries[0]?.reason).toBe('position_overflow');
  });
});
