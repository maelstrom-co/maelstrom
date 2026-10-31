import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});

/** Layout membership projection, not geometry or retained-state semantics. */
export const calendarWeekNavStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z.array(instance).max(20),
  }),
});

/** Semantic violations remain representable for independent scoring. */
export const calendarWeekNavResponseSchema = calendarWeekNavStateSchema.extend({
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
});

/** Declarative request evidence, not interpreted by a model. */
export const calendarWeekNavTurnInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Exactly three complete snapshots; continuity is not a source-scoring rule. */
export const calendarWeekNavObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: calendarWeekNavTurnInputSchema,
      state: calendarWeekNavStateSchema,
      output: calendarWeekNavResponseSchema,
      resultingState: calendarWeekNavStateSchema,
    }),
  )
  .length(3);

/** Three ordered requests for the bounded round trip. */
export const calendarWeekNavInputsSchema = z.strictObject({
  turns: z.array(calendarWeekNavTurnInputSchema).length(3),
});

/** Task-local showMonthly spelling, deliberately not the dataset's showMonth. */
export const calendarWeekNavExpectationsSchema = z.strictObject({
  instanceId: name,
  weeklyAction: z.literal('showWeekly'),
  monthlyAction: z.literal('showMonthly'),
  weeklyVariant: z.literal('week'),
  monthlyVariant: z.literal('month'),
});

/** Independent response scripts; expectations never manufacture observations. */
export const calendarWeekNavDataSchema = z.strictObject({
  initial: calendarWeekNavStateSchema.refine((state) => {
    const initial = state.layout.instances[0];
    return (
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      initial?.vesselId === 'calendar' &&
      initial.variant === 'month'
    );
  }, 'Expected one month Calendar Instance in the initial tiling layout'),
  responses: z.array(calendarWeekNavResponseSchema).length(3),
});

/** Initial layout and independent scripted responses. */
export type CalendarWeekNavData = z.infer<typeof calendarWeekNavDataSchema>;
/** Ordered request evidence. */
export type CalendarWeekNavInputs = z.infer<typeof calendarWeekNavInputsSchema>;
/** Independent target and source-scoring constraints. */
export type CalendarWeekNavExpectations = z.infer<
  typeof calendarWeekNavExpectationsSchema
>;
/** A single request in the synthetic session. */
export type CalendarWeekNavInput = z.infer<
  typeof calendarWeekNavTurnInputSchema
>;
/** Layout membership snapshot. */
export type CalendarWeekNavState = z.infer<typeof calendarWeekNavStateSchema>;
/** Scripted response projection. */
export type CalendarWeekNavResponse = z.infer<
  typeof calendarWeekNavResponseSchema
>;
