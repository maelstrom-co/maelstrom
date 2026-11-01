import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const vesselId = z.enum(['calendar', 'weather', 'labs']);
export const transitionInstanceSchema = z.strictObject({
  instanceId: name,
  vesselId,
  variant: name,
});
export const transitionInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
  instanceId: name,
  action: name,
});
export const transitionExpectationsSchema = z.strictObject({
  instanceId: name,
  action: name,
  variant: name,
});

/** Navigation-only synthetic projection; no executable handlers or parameterized Actions. */
export const transitionDataSchema = z
  .strictObject({
    vessel: z.strictObject({
      id: vesselId,
      variants: z
        .array(
          z.strictObject({
            name,
            actions: z
              .array(z.strictObject({ name, transitionsTo: name }))
              .max(20),
          }),
        )
        .min(1)
        .max(20),
    }),
    instances: z.array(transitionInstanceSchema).min(1).max(20),
  })
  .superRefine((data, context) => {
    const variants = new Set(data.vessel.variants.map((item) => item.name));
    if (variants.size !== data.vessel.variants.length)
      context.addIssue({ code: 'custom', message: 'Duplicate Variant' });
    for (const item of data.vessel.variants) {
      if (
        new Set(item.actions.map((action) => action.name)).size !==
        item.actions.length
      )
        context.addIssue({
          code: 'custom',
          message: 'Duplicate Action in Variant',
        });
      for (const action of item.actions)
        if (!variants.has(action.transitionsTo))
          context.addIssue({
            code: 'custom',
            message: 'Unknown transition destination',
          });
    }
    if (
      new Set(data.instances.map((item) => item.instanceId)).size !==
      data.instances.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate Instance' });
    for (const instance of data.instances)
      if (
        instance.vesselId !== data.vessel.id ||
        !variants.has(instance.variant)
      )
        context.addIssue({
          code: 'custom',
          message: 'Invalid initial Instance state',
        });
  });

export type VesselTransitionData = z.infer<typeof transitionDataSchema>;
export type VesselTransitionInput = z.infer<typeof transitionInputsSchema>;
export type VesselTransitionExpectations = z.infer<
  typeof transitionExpectationsSchema
>;
export type TransitionInstance = z.infer<typeof transitionInstanceSchema>;

/** Rejects an unrunnable script before any execution; expectations remain independent. */
export function transitionDestination(
  data: VesselTransitionData,
  input: VesselTransitionInput,
): string {
  const instance = data.instances.find(
    (item) => item.instanceId === input.instanceId,
  );
  const action = data.vessel.variants
    .find((item) => item.name === instance?.variant)
    ?.actions.find((item) => item.name === input.action);
  if (!instance || !action)
    throw new Error('Unknown target or unavailable source-Variant Action');
  return action.transitionsTo;
}
