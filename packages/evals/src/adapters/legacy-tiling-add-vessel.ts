import {
  parseTilingSplitToken,
  TilingNodeSchema,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const weather = instance.extend({
  vesselId: z.literal('weather'),
  variant: z.literal('current'),
});
const labs = instance.extend({
  vesselId: z.literal('labs'),
  variant: z.literal('trends'),
});
const calendar = instance.extend({
  vesselId: z.literal('calendar'),
  variant: z.literal('month'),
});

/** Bounded raw tokens retain semantic faults for scoring instead of healing them. */
export const tilingAddLayoutSchema = z.strictObject({
  type: z.enum(['tiling', 'grid']),
  tree: z.array(z.string().max(256).nullable()).max(256),
  instances: z.array(instance).max(20),
});

/** Strict evaluation policy, deliberately stronger than the protocol's repair/visibility projection. */
export function strictTilingLayoutFailures(value: unknown): readonly string[] {
  const parsed = tilingAddLayoutSchema.safeParse(value);
  if (!parsed.success)
    return ['Missing, malformed or oversized layout evidence'];
  const layout = parsed.data;
  if (layout.type !== 'tiling') return ['Expected tiling layout'];
  const ids = new Set(layout.instances.map((item) => item.instanceId));
  if (ids.size !== layout.instances.length)
    return ['Duplicate layout Instance'];
  const visible = new Set<string>();
  let pendingSlots = 1;
  for (const token of layout.tree) {
    if (pendingSlots === 0) return ['Trailing tokens after the complete root'];
    const node = TilingNodeSchema.safeParse(token);
    if (!node.success)
      return ['Invalid tree token; leaves require the ID: prefix'];
    const split = parseTilingSplitToken(node.data);
    if (split !== null) {
      if (split.repaired || split.discardedChildCount !== 0)
        return [
          'Repaired or discarded split weights are not valid evaluation evidence',
        ];
      pendingSlots += split.weights.length - 1;
    } else {
      pendingSlots -= 1;
      const id = tilingLeafInstanceId(node.data);
      if (id === null) continue;
      if (!ids.has(id)) return ['Tree references an unknown Instance'];
      if (visible.has(id)) return ['Duplicate visible Instance leaf'];
      visible.add(id);
    }
  }
  if (pendingSlots !== 0) return ['Incomplete tree root'];
  if (visible.size !== ids.size)
    return ['Retained Instance is hidden from the tree'];
  return [];
}

/** Layout state snapshots, without renderer geometry or Action effects. */
export const tilingAddStateSchema = z.strictObject({
  layout: tilingAddLayoutSchema,
});
/** Plans are present as evidence but do not participate in this layout-only verdict. */
export const tilingAddResponseSchema = tilingAddStateSchema.extend({
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
});
/** Request text is retained, not interpreted. */
export const tilingAddInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});
/** Independent retained identities and a fresh synthetic Calendar identity. */
export const tilingAddExpectationsSchema = z
  .strictObject({
    retainedInstances: z.tuple([weather, labs]),
    addedInstance: calendar,
  })
  .refine(
    (expected) =>
      new Set([
        ...expected.retainedInstances.map((item) => item.instanceId),
        expected.addedInstance.instanceId,
      ]).size === 3,
    'Expected distinct retained and new Instance identities',
  );
/** One complete session turn; no missing-evidence defaults. */
export const tilingAddObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: tilingAddInputsSchema,
      state: tilingAddStateSchema,
      output: tilingAddResponseSchema,
      resultingState: tilingAddStateSchema,
    }),
  )
  .length(1);
/** Scripted output is independent of expectations; the initial scene is validated. */
export const tilingAddDataSchema = z.strictObject({
  registeredVessels: z.tuple([
    z.literal('weather'),
    z.literal('labs'),
    z.literal('calendar'),
  ]),
  initial: tilingAddStateSchema.refine(
    (state) =>
      state.layout.instances.length === 2 &&
      state.layout.instances.some((item) => weather.safeParse(item).success) &&
      state.layout.instances.some((item) => labs.safeParse(item).success) &&
      strictTilingLayoutFailures(state.layout).length === 0,
    'Expected visible current Weather and trends Labs in a valid initial tree',
  ),
  response: tilingAddResponseSchema,
});

/** Initial registered scene and independent scripted response. */
export type TilingAddData = z.infer<typeof tilingAddDataSchema>;
/** Independent preservation/addition expectations. */
export type TilingAddExpectations = z.infer<typeof tilingAddExpectationsSchema>;
/** A single declarative request. */
export type TilingAddInput = z.infer<typeof tilingAddInputsSchema>;
/** Bounded layout state projection. */
export type TilingAddState = z.infer<typeof tilingAddStateSchema>;
/** Layout response with an unscored Execution Plan. */
export type TilingAddResponse = z.infer<typeof tilingAddResponseSchema>;
