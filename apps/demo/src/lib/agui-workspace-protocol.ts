import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import {
  ChartDimensionsSchema,
  type ChartRequestMessage,
  ChartRequestMessageSchema,
  GridLayoutSchema,
  MaelstromResponseMessageSchema,
  TilingLayoutSchema,
  VesselInstanceSnapshotSchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

const Id = z.string().min(1).max(256);
export const WORKSPACE_RUN = 'demo.agui.run';
export const WORKSPACE_RESULT = 'demo:workspace-result';
export const APPLICATION_RESULT = 'demo:application-result';
export const MAX_WORKSPACE_FRAME_BYTES = 1_048_576;

export const WorkspaceCorrelationSchema = z.object({
  threadId: Id,
  runId: Id,
  requestId: Id,
  callId: Id,
  revision: z.number().int().nonnegative(),
});
export const WorkspaceApplicationSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  status: z.enum(['applied', 'failed']),
  actions: z
    .array(
      z.object({
        instanceId: Id,
        action: Id,
        succeeded: z.boolean(),
      }),
    )
    .max(256),
  chart: z.object({
    instances: z.array(VesselInstanceSnapshotSchema).max(256),
    layout: z
      .union([
        GridLayoutSchema.extend({ type: z.literal('grid') }),
        TilingLayoutSchema.extend({ type: z.literal('tiling') }),
      ])
      .nullable(),
    layoutMode: z.enum(['grid', 'tiling']),
    chartDimensions: ChartDimensionsSchema,
  }),
});
export type WorkspaceOperation =
  | {
      kind: 'plan';
      sequence: number;
      revision: number;
      message: ChartRequestMessage;
    }
  | { kind: 'applied'; sequence: number; application: WorkspaceApplication };
export const WorkspaceOperationSchema: z.ZodType<WorkspaceOperation> =
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('plan'),
      sequence: z.number().int().positive(),
      revision: z.number().int().nonnegative(),
      message: ChartRequestMessageSchema,
    }),
    z.object({
      kind: z.literal('applied'),
      sequence: z.number().int().positive(),
      application: WorkspaceApplicationSchema,
    }),
  ]);
export type WorkspaceRun = {
  threadId: string;
  runId: string;
  messages: never[];
  tools: never[];
  context: never[];
  state: null;
  forwardedProps: WorkspaceOperation;
};
export const WorkspaceRunSchema: z.ZodType<WorkspaceRun> =
  RunAgentInputSchema.extend({
    threadId: Id,
    runId: Id,
    messages: z.array(z.never()).max(0),
    tools: z.array(z.never()).max(0),
    context: z.array(z.never()).max(0),
    state: z.null(),
    forwardedProps: WorkspaceOperationSchema,
  });
export const WorkspaceResultSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  envelope: MaelstromResponseMessageSchema,
});
export const ApplicationResultSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(['applied', 'failed']),
});
export type WorkspaceResult = z.infer<typeof WorkspaceResultSchema>;
export type WorkspaceApplication = z.infer<typeof WorkspaceApplicationSchema>;
export type WorkspaceCorrelation = z.infer<typeof WorkspaceCorrelationSchema>;

// Only non-content protocol evidence belongs in a hibernation attachment.
export const WorkspaceCheckpointSchema = z.object({
  threadId: Id,
  sequence: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  stopped: z.boolean(),
  pending: z
    .object({
      correlation: WorkspaceCorrelationSchema,
      actionsDigest: z.string().length(64),
    })
    .nullable(),
});
export type WorkspaceCheckpoint = z.infer<typeof WorkspaceCheckpointSchema>;

export function workspaceRun(
  threadId: string,
  operation: WorkspaceOperation,
): WorkspaceRun {
  return WorkspaceRunSchema.parse({
    threadId,
    runId: crypto.randomUUID(),
    messages: [],
    tools: [],
    context: [],
    state: null,
    forwardedProps: operation,
  });
}

export function readWorkspaceRun(raw: string): WorkspaceRun | undefined {
  if (raw.length > MAX_WORKSPACE_FRAME_BYTES) return;
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    !frame ||
    typeof frame !== 'object' ||
    !('type' in frame) ||
    frame.type !== WORKSPACE_RUN ||
    !('input' in frame)
  )
    return;
  const input = WorkspaceRunSchema.safeParse(frame.input);
  return input.success ? input.data : undefined;
}

export async function actionDigest(
  actions: readonly { instanceId: string; action: string }[],
) {
  const identities = actions.map(({ instanceId, action }) => [
    instanceId,
    action,
  ]);
  identities.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const bytes = new TextEncoder().encode(JSON.stringify(identities));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
