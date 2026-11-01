import {
  ActionExecutionSchema,
  TilingNodeSchema,
  VesselInstanceSnapshotSchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

const name = z.string().min(1).max(120);

/** Bounded tiling candidate, before Engine healing; semantic faults are not pre-scored. */
export const scriptedCandidateDataSchema = z.strictObject({
  candidate: z.strictObject({
    userMessage: z.string().max(2000),
    rationale: z.string().max(2000),
    executionPlan: z
      .array(
        z
          .strictObject({
            instanceId: name,
            action: name,
            paramsJson: z.string().max(4000).optional(),
          })
          .pipe(ActionExecutionSchema),
      )
      .max(20),
    layout: z.strictObject({
      tree: z
        .array(z.string().max(256).nullable().pipe(TilingNodeSchema))
        .max(256),
      instances: z
        .array(
          z
            .strictObject({ instanceId: name, vesselId: name, variant: name })
            .pipe(VesselInstanceSnapshotSchema),
        )
        .max(20),
    }),
  }),
});

/** Independently authored candidate data; no scenario expectations are embedded. */
export type ScriptedCandidateData = z.infer<typeof scriptedCandidateDataSchema>;
