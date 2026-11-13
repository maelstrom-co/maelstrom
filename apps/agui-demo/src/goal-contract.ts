import { z } from 'zod';

import { RecordCommandSchema } from './records';

export const GoalSummary = z
  .object({
    status: z
      .enum(['completed', 'incomplete'])
      .describe(
        'completed only when every requested effect is confirmed or the read-only question is answered; incomplete for refusals, missing views, unavailable data, or needed clarification',
      ),
    message: z
      .string()
      .min(1)
      .max(8_000)
      .describe(
        'Brief user-facing outcome supported by the authoritative records and visible Chart',
      ),
  })
  .strict();

export const ApplyWorkspaceInput = z.object({
  intent: z.string().trim().min(1).max(8_000),
  expectedMutation: RecordCommandSchema.nullable().describe(
    'The exact single Journal, Task, or Calendar record change this call must commit. Use null only for calls that do not change saved records. Existing records require their authoritative ID and version.',
  ),
});
export const ApplyWorkspaceResult = z
  .object({
    requestId: z.string().min(1).max(256),
    status: z.literal('applied'),
  })
  .strict();
export const applyWorkspaceTool = {
  name: 'apply_workspace',
  description:
    'Arrange the six workspace Vessels or perform ONE application-effect Action. Declare the exact expectedMutation, or null for no record change. Wait for its verified result before dependent work. Include exact record IDs and versions for existing records. Create and append require separate calls.',
  parameters: z.toJSONSchema(ApplyWorkspaceInput),
};
