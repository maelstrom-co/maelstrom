import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const names = z
  .array(name)
  .min(1)
  .max(20)
  .refine((values) => new Set(values).size === values.length);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const instances = z.array(instance).max(20);
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** Scripted response data may violate semantic rules so the oracle can detect those violations. */
export const constraintResponseSchema = z.strictObject({
  assistantText: z.string().max(2000),
  executionPlan: z
    .array(
      z.strictObject({
        instanceId: name,
        action: name,
        params: z.record(name, scalar).nullable().optional(),
      }),
    )
    .max(20),
  instances,
  /** Type/Instance-state projection only; this is not full layout geometry evidence. */
  layout: z
    .strictObject({
      type: z.enum(['tiling', 'grid']),
      instances,
    })
    .optional(),
});
export const constraintInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
  response: constraintResponseSchema,
});
export const constraintExpectationsSchema = z.strictObject({
  rule: z.enum([
    'valid-actions-preserve-state',
    'marker-enum',
    'no-op',
    'no-op-tiling',
  ]),
});

/** Narrow fixture contracts, not full Vessel definitions or runtime handlers. */
export const constraintDataSchema = z
  .discriminatedUnion('vesselId', [
    z.strictObject({
      vesselId: z.literal('weather'),
      variants: z
        .array(
          z.strictObject({
            name,
            actions: z
              .array(name)
              .max(20)
              .refine((values) => new Set(values).size === values.length),
          }),
        )
        .min(1)
        .max(20),
      instances: instances.min(1),
    }),
    z.strictObject({
      vesselId: z.literal('labs'),
      variants: names,
      markerSlugs: names,
      instances: instances.min(1),
    }),
  ])
  .superRefine((data, context) => {
    const variants =
      data.vesselId === 'weather'
        ? data.variants.map((item) => item.name)
        : data.variants;
    if (new Set(variants).size !== variants.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate initial Variant',
      });
    if (
      new Set(data.instances.map((item) => item.instanceId)).size !==
      data.instances.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Duplicate initial Instance',
      });
    for (const item of data.instances)
      if (item.vesselId !== data.vesselId || !variants.includes(item.variant))
        context.addIssue({
          code: 'custom',
          message: 'Invalid initial Instance state',
        });
  });

export type ResponseConstraintData = z.infer<typeof constraintDataSchema>;
export type ResponseConstraintInput = z.infer<typeof constraintInputsSchema>;
export type ResponseConstraintExpectations = z.infer<
  typeof constraintExpectationsSchema
>;
export type ConstraintResponse = z.infer<typeof constraintResponseSchema>;

/** Keeps the enum-only rule on Labs and the state-preservation rules on Weather. */
export function validateResponseConstraint(
  data: ResponseConstraintData,
  expected: ResponseConstraintExpectations,
): void {
  if ((expected.rule === 'marker-enum') !== (data.vesselId === 'labs'))
    throw new Error('Incompatible response constraint and fixture');
}
