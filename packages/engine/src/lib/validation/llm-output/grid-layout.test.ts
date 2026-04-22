import { describe, expect, test } from 'bun:test';
import type { GridResponse } from '@maelstrom-co/protocol';
import { InstanceId, isErr, isOk } from '@maelstrom-co/protocol';

import { makeGridRequest } from '../../__test-helpers__/fixtures.js';
import { validateGridLayout } from './grid-layout.js';

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

describe('validateGridLayout', () => {
  test('accepts a well-formed grid response', () => {
    const result = validateGridLayout(makeGridResponse(), makeGridRequest());
    expect(isOk(result)).toBe(true);
  });

  test('fails with missing_rationale when rationale is empty', () => {
    const result = validateGridLayout(
      makeGridResponse({ rationale: '   ' }),
      makeGridRequest(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toEqual([{ kind: 'missing_rationale' }]);
  });

  test('fails with duplicate_instance_id when positions share an id', () => {
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'duplicate_instance_id',
      instanceId: 'calendar-main',
    });
  });

  test('fails with position_overflow when position+size exceeds chart dimensions', () => {
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures[0]).toEqual({
      kind: 'position_overflow',
      instanceId: 'calendar-main',
      row: 6,
      column: 10,
      width: 4,
      height: 4,
      chartColumns: 12,
      chartRows: 8,
    });
  });

  test('fails with size_below_minimum when size is smaller than variant minSize', () => {
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'size_below_minimum',
      instanceId: 'calendar-main',
      width: 2,
      height: 2,
      minWidth: 4,
      minHeight: 4,
    });
  });

  test('fails with unknown_vessel when instance references a vessel not in request', () => {
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'ghost-vessel',
          variant: 'month',
        },
      ],
    });
    const result = validateGridLayout(makeGridResponse(), request);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'unknown_vessel',
      instanceId: 'calendar-main',
      vesselId: 'ghost-vessel',
    });
  });

  test('fails with unknown_variant when instance variant is not on vessel', () => {
    const request = makeGridRequest({
      instances: [
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: 'calendar',
          variant: 'nonexistent',
        },
      ],
    });
    const result = validateGridLayout(makeGridResponse(), request);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'unknown_variant',
      instanceId: 'calendar-main',
      variant: 'nonexistent',
    });
  });

  test('position_overflow fires on +1 width overflow (boundary off-by-one)', () => {
    // Chart is 12 cols × 8 rows. Size 4×4 at column 9 puts right edge at 13,
    // exceeding the 12-column boundary by exactly 1.
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures[0]?.kind).toBe('position_overflow');
  });

  test('position_overflow fires on +1 height overflow (boundary off-by-one)', () => {
    // Chart is 12 cols × 8 rows. Size 4×4 at row 5 puts bottom edge at 9,
    // exceeding the 8-row boundary by exactly 1.
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures[0]?.kind).toBe('position_overflow');
  });

  test('fails with unknown_instance when position references no request instance', () => {
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'unknown_instance',
      instanceId: 'not-in-request',
    });
  });

  test('collects multiple failures in a single pass', () => {
    const result = validateGridLayout(
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
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    const kinds = result.error.failures.map((f) => f.kind);
    expect(kinds).toContain('missing_rationale');
    expect(kinds).toContain('duplicate_instance_id');
    expect(kinds).toContain('size_below_minimum');
    expect(kinds).toContain('position_overflow');
  });

  test('position at the exact edge of chart dimensions is valid', () => {
    // chartDimensions: 12 cols, 8 rows; position (4, 8) size 4x4 ends at (8, 12) — exactly the edges
    const result = validateGridLayout(
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
    expect(isOk(result)).toBe(true);
  });
});
