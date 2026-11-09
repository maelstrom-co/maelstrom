import { WorkspaceApplicationSchema } from '@maelstrom-co/agui-protocol';
import {
  ChartRequestSchema,
  MaelstromResponseMessageSchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import { RecordCommandSchema, type Records, RecordsSchema } from '../records';
import type { IssuedPlan } from './issued-plans';

export const IssuedPlanSchema: z.ZodType<IssuedPlan> = z.object({
  response: MaelstromResponseMessageSchema.shape.response,
  request: ChartRequestSchema,
  toolCallId: z.string().optional(),
  effect: z
    .object({
      index: z.number().int().nonnegative(),
      command: RecordCommandSchema.optional(),
      allocatedId: z.string(),
    })
    .optional(),
  receipt: z
    .object({ records: RecordsSchema, recordId: z.string() })
    .optional(),
  settled: z.boolean(),
  accepted: z
    .object({
      application: WorkspaceApplicationSchema,
      observation: ChartRequestSchema,
    })
    .optional(),
});

export interface PlanStorage {
  load(): { records: Records; plans: IssuedPlan[] };
  // Records and their receipt must commit together before the caller exposes either.
  commit(plan: IssuedPlan, records?: Records): void;
}
