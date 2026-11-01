import { z } from 'zod';

const name = z.string().min(1).max(120);
const turnInput = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Layout membership projection only; source scoring does not inspect tree geometry. */
export const historyAssistantInjectionStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z
      .array(
        z.strictObject({
          instanceId: name,
          vesselId: name,
          variant: name,
        }),
      )
      .max(20),
  }),
});

/** Empty or absent text is representable because the source permits it on turn 2. */
export const historyAssistantInjectionResponseSchema =
  historyAssistantInjectionStateSchema.extend({
    assistantText: z.string().max(2000).optional(),
    executionPlan: z
      .array(z.strictObject({ instanceId: name, action: name }))
      .max(20),
  });

/** Three independently scripted observations; no expected results generate responses. */
export const historyAssistantInjectionDataSchema = z.strictObject({
  initial: historyAssistantInjectionStateSchema,
  responses: z.array(historyAssistantInjectionResponseSchema).length(3),
});

/** Three ordinary Weather user-turn fallback prompts; no injected assistant payload. */
export const historyAssistantInjectionInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(3),
});

/** Ordinary conversation-history predicate only; injection robustness is outside this scope. */
export const historyAssistantInjectionExpectationsSchema = z.strictObject({
  instanceId: z.literal('weather-main'),
  action: z.literal('showHourly'),
  variants: z.tuple([
    z.literal('current'),
    z.literal('hourly'),
    z.literal('hourly'),
  ]),
  coverage: z.literal('COMPLETE'),
});

/** Exactly three complete harness turns; state snapshots are evidence, not extra source predicates. */
export const historyAssistantInjectionObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: turnInput,
      state: historyAssistantInjectionStateSchema,
      output: historyAssistantInjectionResponseSchema,
      resultingState: historyAssistantInjectionStateSchema,
    }),
  )
  .length(3);

/** Independent synthetic response script and initial layout. */
export type HistoryAssistantInjectionData = z.infer<
  typeof historyAssistantInjectionDataSchema
>;
/** Source fallback request sequence. */
export type HistoryAssistantInjectionInputs = z.infer<
  typeof historyAssistantInjectionInputsSchema
>;
/** Declarative ordinary-history predicate and declared-scope completion. */
export type HistoryAssistantInjectionExpectations = z.infer<
  typeof historyAssistantInjectionExpectationsSchema
>;
/** Bounded layout snapshot; no Action execution is simulated. */
export type HistoryAssistantInjectionState = z.infer<
  typeof historyAssistantInjectionStateSchema
>;
/** Bounded source response projection. */
export type HistoryAssistantInjectionResponse = z.infer<
  typeof historyAssistantInjectionResponseSchema
>;
