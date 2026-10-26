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
/** Private ingress name retained for compatibility with the experimental demo. */
export const WORKSPACE_RUN = 'demo.agui.run';
/** Private result event carrying a validated Engine response. */
export const WORKSPACE_RESULT = 'demo:workspace-result';
/** Private result event accepting client application evidence. */
export const APPLICATION_RESULT = 'demo:application-result';
/** Maximum encoded workspace frame size accepted by this binding. */
export const MAX_WORKSPACE_FRAME_BYTES = 1_048_576;

/** Identifies the exact response whose application is being acknowledged. */
export const WorkspaceCorrelationSchema = z.object({
  threadId: Id,
  runId: Id,
  requestId: Id,
  callId: Id,
  revision: z.number().int().nonnegative(),
});
/** Client-owned application outcome and structural snapshot. */
export const WorkspaceApplicationSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  status: z.enum(['applied', 'failed', 'unknown']),
  actions: z
    .array(
      z.object({
        instanceId: z.string().min(1),
        action: z.string().min(1),
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
/** Private run-boundary input; this is not standard AG-UI mid-run ingress. */
export type WorkspaceOperation =
  | {
      /** Request planning from the existing Engine. */
      kind: 'plan';
      /** Monotonic operation counter for this socket session. */
      sequence: number;
      /** Last acknowledged workspace revision. */
      revision: number;
      /** Authoritative request assembled by the client. */
      message: ChartRequestMessage;
    }
  | {
      /** Report application settlement for a previously delivered response. */
      kind: 'applied';
      /** Monotonic operation counter for this socket session. */
      sequence: number;
      /** Correlated application evidence. */
      application: WorkspaceApplication;
    };
/** Validates private operations before server dispatch. */
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
/** Restricted RunAgentInput used by the experimental workspace binding. */
export type WorkspaceRun = {
  /** Application session identity. */
  threadId: string;
  /** Fresh identity for this operation's run. */
  runId: string;
  /** Unused; workspace requests are carried in forwardedProps. */
  messages: never[];
  /** Unused; Vessel Actions are not frontend tools. */
  tools: never[];
  /** Unused; context belongs to the Chart request. */
  context: never[];
  /** Unused; the binding does not synchronize AG-UI state. */
  state: null;
  /** Private operation interpreted by both adapter endpoints. */
  forwardedProps: WorkspaceOperation;
};
/** Validates the supported subset of AG-UI RunAgentInput. */
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
/** Validated Engine response with application correlation. */
export const WorkspaceResultSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  envelope: MaelstromResponseMessageSchema,
});
/** Server acceptance of a client application outcome. */
export const ApplicationResultSchema = z.object({
  correlation: WorkspaceCorrelationSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(['applied', 'failed', 'unknown']),
});
/** Decoded workspace response and its correlation. */
export type WorkspaceResult = z.infer<typeof WorkspaceResultSchema>;
/** Decoded client application evidence. */
export type WorkspaceApplication = z.infer<typeof WorkspaceApplicationSchema>;
/** Correlation shared by a response and its application result. */
export type WorkspaceCorrelation = z.infer<typeof WorkspaceCorrelationSchema>;

// Only non-content protocol evidence belongs in a hibernation attachment.
/** Non-content session evidence suitable for a host-owned socket checkpoint. */
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
/** Restorable admission state; contains no credentials or application content. */
export type WorkspaceCheckpoint = z.infer<typeof WorkspaceCheckpointSchema>;

/** Create a fresh run for a validated private operation. */
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

/** Decode private ingress, returning undefined for unrelated or invalid input. */
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

/** Hash the multiset of Action identities without retaining parameters. */
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
export { sameCorrelation } from './correlation.js';
