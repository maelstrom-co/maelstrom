import {
  type ChartRequestMessage,
  ChartRequestMessageSchema,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

export const JournalReadSchema = z.object({
  activeEntryId: z.string().nullable(),
  entries: z
    .array(z.object({ id: z.string(), title: z.string(), content: z.string() }))
    .max(1000),
});
export const CorrelationSchema = z.object({
  sessionId: z.string(),
  goalId: z.string().nullable(),
  runId: z.string(),
  requestId: z.string(),
  callId: z.string(),
  revision: z.number().int().nonnegative(),
});
const AppliedLayoutSchema = TilingResponseSchema.shape.layout.extend({
  type: z.literal('tiling'),
});
export const PlanSchema = z.object({
  correlation: CorrelationSchema,
  response: TilingResponseSchema.extend({
    type: z.literal('maelstrom_response'),
    requestId: z.string(),
    layout: AppliedLayoutSchema,
    // The Engine has already parsed JSON-string model parameters.
    executionPlan: z.array(
      z.object({
        instanceId: z.string(),
        action: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
  expectedEntryId: z.string().nullable(),
});
export const StateSchema = z.object({
  phase: z.enum(['ready', 'create', 'annotate', 'complete', 'stopped']),
  goalId: z.string().nullable(),
  observedId: z.string().nullable(),
  revision: z.number().int(),
});
export const AckSchema = z.object({
  correlation: CorrelationSchema,
  status: z.enum(['applied', 'failed', 'unknown']),
  chart: z.object({
    layout: AppliedLayoutSchema.nullable(),
    instances: TilingResponseSchema.shape.layout.shape.instances,
    chartDimensions: z.object({ columns: z.number(), rows: z.number() }),
  }),
  actions: z.array(
    z.object({
      instanceId: z.string(),
      action: z.string(),
      succeeded: z.boolean(),
    }),
  ),
  journal: JournalReadSchema,
});
export type AgentOperation =
  | {
      kind: 'plan';
      revision: number;
      message: ChartRequestMessage;
      journal: JournalRead;
      goal?: { id: string; title: string };
    }
  | { kind: 'ack'; ack: ApplicationAck };
export const OperationSchema: z.ZodType<AgentOperation> = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('plan'),
      revision: z.number().int(),
      message: ChartRequestMessageSchema,
      journal: JournalReadSchema,
      goal: z
        .object({ id: z.string(), title: z.string().trim().min(1).max(120) })
        .optional(),
    }),
    z.object({ kind: z.literal('ack'), ack: AckSchema }),
  ],
);
export type AgentPlan = z.infer<typeof PlanSchema>;
export type AgentState = z.infer<typeof StateSchema>;
export type ApplicationAck = z.infer<typeof AckSchema>;
export type JournalRead = z.infer<typeof JournalReadSchema>;

export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((v, i) => sameValue(v, right[i]))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const a = Object.entries(left).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(right).sort(([x], [y]) => x.localeCompare(y));
  return sameValue(a, b);
}
