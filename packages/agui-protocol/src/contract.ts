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
/** Experimental Maelstrom workspace ingress identifier, retained for endpoint compatibility. */
export const WORKSPACE_RUN = 'demo.agui.run';
/** Experimental custom event carrying a validated Engine response. */
export const WORKSPACE_RESULT = 'demo:workspace-result';
/** Experimental custom event accepting client application evidence. */
export const APPLICATION_RESULT = 'demo:application-result';
/** Maximum encoded workspace frame size accepted by this binding. */
export const MAX_WORKSPACE_FRAME_BYTES = 1_048_576;

/** Identifies the exact response whose application is being acknowledged. */
export const WorkspaceCorrelationSchema = z.object({
  /** Authorized application session. */
  threadId: Id,
  /** Planning run that produced the response. */
  runId: Id,
  /** Client Chart request identity. */
  requestId: Id,
  /** Server-issued identity for this application. */
  callId: Id,
  /** Last accepted workspace revision before application. */
  revision: z.number().int().nonnegative(),
});
/** Client-owned application outcome and structural snapshot. */
export const WorkspaceApplicationSchema = z.object({
  /** Exact response whose application settled. */
  correlation: WorkspaceCorrelationSchema,
  /** Whole-batch outcome; uncertainty never permits replay. */
  status: z.enum(['applied', 'failed', 'unknown']),
  /** Observed outcomes, including skipped Actions as unsuccessful. */
  actions: z
    .array(
      z.object({
        /** Target Instance identity. */
        instanceId: z.string().min(1),
        /** Declared Action name. */
        action: z.string().min(1),
        /** Whether execution and any transition succeeded. */
        succeeded: z.boolean(),
      }),
    )
    .max(256),
  /** Client-owned structural observation at settlement. */
  chart: z.object({
    /** Visible and hidden retained Instances. */
    instances: z.array(VesselInstanceSnapshotSchema).max(256),
    /** Observed Layout, or null before a Layout exists. */
    layout: z
      .union([
        GridLayoutSchema.extend({ type: z.literal('grid') }),
        TilingLayoutSchema.extend({ type: z.literal('tiling') }),
      ])
      .nullable(),
    /** Layout mode represented by this observation. */
    layoutMode: z.enum(['grid', 'tiling']),
    /** Chart-container dimensions in grid units. */
    chartDimensions: ChartDimensionsSchema,
  }),
});
/** Experimental run-boundary input; separate from standard AG-UI mid-run ingress. */
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
/** Validates workspace operations before server dispatch. */
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
  /** Maelstrom-specific operation interpreted by both adapter endpoints. */
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
  /** Identity required for the later application acknowledgment. */
  correlation: WorkspaceCorrelationSchema,
  /** Validated Engine response in its native envelope. */
  envelope: MaelstromResponseMessageSchema,
});
/** Server acceptance of a client application outcome. */
export const ApplicationResultSchema = z.object({
  /** Identity of the application evidence being accepted. */
  correlation: WorkspaceCorrelationSchema,
  /** Workspace revision after accepting the evidence. */
  revision: z.number().int().nonnegative(),
  /** Accepted whole-batch outcome. */
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
  /** Authorized session owning this checkpoint. */
  threadId: Id,
  /** Last admitted operation sequence. */
  sequence: z.number().int().nonnegative(),
  /** Last accepted application revision. */
  revision: z.number().int().nonnegative(),
  /** Whether this session permanently rejects further planning. */
  stopped: z.boolean(),
  /** Outstanding response evidence; null when no application is pending. */
  pending: z
    .object({
      /** Exact response awaiting acknowledgment. */
      correlation: WorkspaceCorrelationSchema,
      /** SHA-256 digest of Action identities, including duplicates. */
      actionsDigest: z.string().length(64),
      /** Version 2 uses deterministic ordering; older pending digests cannot resume. */
      digestVersion: z.literal(2).optional(),
    })
    .nullable(),
});
/** Restorable admission state; contains no credentials or application content. */
export type WorkspaceCheckpoint = z.infer<typeof WorkspaceCheckpointSchema>;

/** Create a fresh run for a validated workspace operation; throws on invalid input. */
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

/** Decode workspace ingress, returning undefined for unrelated, oversized, or invalid input. */
export function readWorkspaceRun(raw: string): WorkspaceRun | undefined {
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_FRAME_BYTES)
    return;
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

/** Hash the multiset of Action identities without retaining parameters; does not certify Action order or business effects. */
export async function actionDigest(
  actions: readonly {
    /** Target Instance identity. */
    instanceId: string;
    /** Declared Action name. */
    action: string;
  }[],
) {
  const identities = actions.map(({ instanceId, action }) => [
    instanceId,
    action,
  ]);
  identities.sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(identities));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export { sameCorrelation } from './correlation.js';
