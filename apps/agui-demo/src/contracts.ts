import { type ChartRequest, ChartRequestSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';

export interface WorkspaceExchange {
  frame: string;
  toolCallId?: string;
  observation?: ChartRequest;
}

export const WorkspaceExchangeSchema: z.ZodType<WorkspaceExchange> = z.object({
  frame: z.string().max(512_000),
  toolCallId: z.string().min(1).max(200).optional(),
  observation: ChartRequestSchema.optional(),
});
