import {
  ChartDimensionsSchema,
  MaelstromResponseMessageSchema,
  VesselInstanceSnapshotSchema,
} from '@maelstrom-co/protocol';
import { convertSchemaToJsonSchema, toolDefinition } from '@tanstack/ai';
import { z } from 'zod';

export const ResponseSchema = MaelstromResponseMessageSchema.shape.response;
export const SnapshotSchema = z.object({
  instances: z.array(VesselInstanceSnapshotSchema),
  layout: ResponseSchema.shape.layout.nullable(),
  layoutMode: z.literal('tiling'),
  chartDimensions: ChartDimensionsSchema,
});
export const ApplySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  response: ResponseSchema,
});
export const AckSchema = z.object({
  callId: z.string(),
  requestId: z.string(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['applied', 'unknown', 'rejected']),
  actions: z.array(
    z.object({
      instanceId: z.string(),
      action: z.string(),
      status: z.enum(['succeeded', 'failed', 'skipped']),
    }),
  ),
  snapshot: SnapshotSchema,
});
export type Apply = z.infer<typeof ApplySchema>;
export type Ack = z.infer<typeof AckSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const RecordSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
});
export type RecordFact = z.infer<typeof RecordSchema>;

export const applyTool = toolDefinition({
  name: 'apply_workspace',
  description:
    'Apply one Engine-validated workspace response and report structural settlement.',
  inputSchema: ApplySchema,
  outputSchema: AckSchema,
});

export const frontendTools = [
  {
    name: applyTool.name,
    description: applyTool.description,
    parameters: convertSchemaToJsonSchema(ApplySchema),
  },
];

export const emptySnapshot: Snapshot = {
  instances: [],
  layout: null,
  layoutMode: 'tiling',
  chartDimensions: { columns: 12, rows: 8 },
};
