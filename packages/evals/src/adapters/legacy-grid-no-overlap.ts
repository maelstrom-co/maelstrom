import { GridPositionSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const cell = z.number().finite().min(-1_000_000).max(1_000_000);
const chartDimensions = z.strictObject({
  rows: z.number().int().min(1).max(1000),
  columns: z.number().int().min(1).max(1000),
});
const instanceIds = z
  .array(name)
  .length(5)
  .refine((ids) => new Set(ids).size === 5);
const instance = (vesselId: string, variant: string) =>
  z.strictObject({
    instanceId: name,
    vesselId: z.literal(vesselId),
    variant: z.literal(variant),
  });

/** Raw bounded GridLayout-shaped evidence keeps numeric/semantic faults available to the oracle. */
export const gridNoOverlapLayoutSchema = z.strictObject({
  type: z.enum(['grid', 'tiling']),
  positions: z
    .array(
      z.strictObject({
        instanceId: name,
        position: z.strictObject({ row: cell, column: cell }),
        size: z.strictObject({ width: cell, height: cell }),
      }),
    )
    .max(20),
});

/** Independent Chart and exact visible-identity contract; no viewport or minimum-size policy. */
export const gridNoOverlapExpectationsSchema = z.strictObject({
  chartDimensions,
  instanceIds,
});

/** Checks cell allocations only, without compactness, minimum-size, healing or Action semantics. */
export function gridNoOverlapLayoutFailures(
  value: unknown,
  expected: GridNoOverlapExpectations,
): readonly string[] {
  const parsed = gridNoOverlapLayoutSchema.safeParse(value);
  if (!parsed.success) return ['Missing, malformed or oversized grid evidence'];
  const layout = parsed.data;
  if (layout.type !== 'grid') return ['Expected grid layout'];
  const ids = layout.positions.map((item) => item.instanceId);
  if (
    ids.length !== 5 ||
    new Set(ids).size !== 5 ||
    !expected.instanceIds.every((id) => ids.includes(id))
  )
    return ['Expected exactly five unique known grid positions'];
  for (const item of layout.positions) {
    if (!GridPositionSchema.safeParse(item).success)
      return [
        'Grid coordinates must be nonnegative integers and sizes positive integers',
      ];
    if (
      item.position.row + item.size.height > expected.chartDimensions.rows ||
      item.position.column + item.size.width > expected.chartDimensions.columns
    )
      return ['Grid position exceeds Chart bounds'];
  }
  for (const [index, a] of layout.positions.entries()) {
    for (const b of layout.positions.slice(index + 1)) {
      if (
        a.position.column < b.position.column + b.size.width &&
        b.position.column < a.position.column + a.size.width &&
        a.position.row < b.position.row + b.size.height &&
        b.position.row < a.position.row + a.size.height
      )
        return ['Grid positions overlap'];
    }
  }
  return [];
}

/** Grid snapshots resolve IDs against fixture metadata, not metadata embedded in positions. */
export const gridNoOverlapStateSchema = z.strictObject({
  layout: gridNoOverlapLayoutSchema,
});
/** Plans are structurally present but do not affect this layout-only verdict. */
export const gridNoOverlapResponseSchema = gridNoOverlapStateSchema.extend({
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
});
/** Dataset wording is evidence only; no model interprets the request. */
export const gridNoOverlapInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});
/** One complete single-turn observation with no defaults for missing evidence. */
export const gridNoOverlapObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: gridNoOverlapInputsSchema,
      state: gridNoOverlapStateSchema,
      output: gridNoOverlapResponseSchema,
      resultingState: gridNoOverlapStateSchema,
    }),
  )
  .length(1);
/** Known retained Instances, explicit Chart cells, and independent initial/response layouts. */
export const gridNoOverlapDataSchema = z
  .strictObject({
    chartDimensions,
    instances: z.tuple([
      instance('weather', 'current'),
      instance('labs', 'trends'),
      instance('calendar', 'month'),
      instance('email', 'inbox'),
      instance('tasks', 'pending'),
    ]),
    initial: gridNoOverlapStateSchema,
    response: gridNoOverlapResponseSchema,
  })
  .refine((data) => {
    const ids = data.instances.map((item) => item.instanceId);
    return (
      new Set(ids).size === 5 &&
      gridNoOverlapLayoutFailures(data.initial.layout, {
        chartDimensions: data.chartDimensions,
        instanceIds: ids,
      }).length === 0
    );
  }, 'Expected five distinct known Instances in a valid initial Chart allocation');

/** Source-context metadata and independent scripted response. */
export type GridNoOverlapData = z.infer<typeof gridNoOverlapDataSchema>;
/** Independent Chart bounds and visible identities. */
export type GridNoOverlapExpectations = z.infer<
  typeof gridNoOverlapExpectationsSchema
>;
/** One declarative request. */
export type GridNoOverlapInput = z.infer<typeof gridNoOverlapInputsSchema>;
/** Grid state without rendered geometry or minimum-size validity claims. */
export type GridNoOverlapState = z.infer<typeof gridNoOverlapStateSchema>;
/** Scripted grid response with an unscored Execution Plan. */
export type GridNoOverlapResponse = z.infer<typeof gridNoOverlapResponseSchema>;
