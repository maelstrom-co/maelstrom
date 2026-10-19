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

/** Bounded raw evidence; malformed semantic tokens reach the oracle without repair. */
export const tilingTreeLayoutSchema = z.strictObject({
  type: z.enum(['tiling', 'grid']),
  tree: z.array(z.string().max(256).nullable()).max(256),
  instances: z.array(instance).max(20),
});

/** Source-specific binary subset, not the runtime's general weighted-tree or repair policy. */
export function strictBinaryTilingLayoutFailures(
  value: unknown,
): readonly string[] {
  const parsed = tilingTreeLayoutSchema.safeParse(value);
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
      if (split.weights.length !== 2)
        return [
          'Binary-subset evaluation requires exactly two children per split',
        ];
      pendingSlots += 1;
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

/** Layout snapshots without geometry, fit or Action-effect evidence. */
export const tilingTreeStateSchema = z.strictObject({
  layout: tilingTreeLayoutSchema,
});
/** Plans are structurally present but their contents do not affect the layout verdict. */
export const tilingTreeResponseSchema = tilingTreeStateSchema.extend({
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
});
/** Request text is retained, not interpreted by a model. */
export const tilingTreeInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});
/** Independently declared Weather preservation and fresh Labs addition. */
export const tilingTreeExpectationsSchema = z
  .strictObject({
    retainedInstance: weather,
    addedInstance: labs,
  })
  .refine(
    (expected) =>
      expected.retainedInstance.instanceId !==
      expected.addedInstance.instanceId,
    'Expected distinct retained Weather and new Labs identities',
  );
/** One complete turn, with no missing-evidence defaults. */
export const tilingTreeObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: tilingTreeInputsSchema,
      state: tilingTreeStateSchema,
      output: tilingTreeResponseSchema,
      resultingState: tilingTreeStateSchema,
    }),
  )
  .length(1);
/** Valid initial Weather scene and independent response script. */
export const tilingTreeDataSchema = z.strictObject({
  registeredVessels: z.tuple([z.literal('weather'), z.literal('labs')]),
  initial: tilingTreeStateSchema.refine(
    (state) =>
      state.layout.instances.length === 1 &&
      weather.safeParse(state.layout.instances[0]).success &&
      strictBinaryTilingLayoutFailures(state.layout).length === 0,
    'Expected visible current Weather alone in a valid initial binary tree',
  ),
  response: tilingTreeResponseSchema,
});

/** Initial registered scene and independent scripted response. */
export type TilingTreeData = z.infer<typeof tilingTreeDataSchema>;
/** Independent preservation/addition expectations. */
export type TilingTreeExpectations = z.infer<
  typeof tilingTreeExpectationsSchema
>;
/** One declarative request. */
export type TilingTreeInput = z.infer<typeof tilingTreeInputsSchema>;
/** Bounded layout state projection. */
export type TilingTreeState = z.infer<typeof tilingTreeStateSchema>;
/** Layout response with an unscored Execution Plan. */
export type TilingTreeResponse = z.infer<typeof tilingTreeResponseSchema>;
