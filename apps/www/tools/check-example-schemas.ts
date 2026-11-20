// Runs inside the published consumer beside the copied examples, so the
// relative imports resolve there, not in this directory. The published schemas
// strip unknown keys, so a successful parse alone would accept a field such as
// `effect` that the published SDK ignores. Dropped fields count as failures.
import {
  MaelstromResponseMessageSchema,
  VesselSchema,
} from '@maelstrom-co/protocol';

import engineResponse from './engine-response.json';
import { ordersVessel } from './orders.vessel';
import { findFieldsDroppedByParse } from './schema-field-coverage';

const failures = [
  ...schemaFailures('orders.vessel.ts', VesselSchema, ordersVessel),
  ...schemaFailures(
    'engine-response.json',
    MaelstromResponseMessageSchema.shape.response,
    engineResponse,
  ),
];
if (failures.length > 0) {
  throw new Error(`Published schema check failed:\n${failures.join('\n')}`);
}
console.log(
  'Published schemas accept orders.vessel.ts and engine-response.json.',
);

interface SafeParser {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { message: string } };
}

function schemaFailures(
  file: string,
  schema: SafeParser,
  input: unknown,
): string[] {
  const result = schema.safeParse(input);
  if (!result.success) return [`${file}: ${result.error.message}`];
  return findFieldsDroppedByParse(input, result.data).map(
    (field) => `${file}: the published schema drops unknown field "${field}"`,
  );
}
