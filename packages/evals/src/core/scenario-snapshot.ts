import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { ChartRequestSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';
import type { Scenario } from './scenario-types.js';

const name = z.string().min(1).max(120);
const request = z.unknown().transform((value, context) => {
  const parsed = ChartRequestSchema.safeParse(value);
  // Protocol schemas can strip unknown fields; a canonical snapshot must be lossless.
  if (!parsed.success || !isDeepStrictEqual(value, parsed.data)) {
    context.addIssue({
      code: 'custom',
      message: 'Invalid or lossy ChartRequest snapshot',
    });
    return z.NEVER;
  }
  return parsed.data;
});

/** Shared declarative inputs; fixture selectors never enter the Scenario. */
export const scenarioSnapshotInputsSchema = z.strictObject({
  scenarioTitle: z.string().trim().min(1).max(2000),
  request,
  history: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(16000),
      }),
    )
    .max(100)
    .optional(),
  spatial: z.boolean().optional(),
});

/** Only the planned predicates used by the migrated cases; no arbitrary oracle configuration. */
export const plannedSnapshotExpectationsSchema = z.strictObject({
  status: z.literal('planned'),
  visible: z.array(name).max(100),
  actions: z.array(z.strictObject({ instanceId: name, action: name })).max(100),
});

/** Constructs only Scenario fields from already validated snapshot data. */
export function scenarioFromSnapshot(definition: {
  scenarioId: string;
  suite: Scenario['suite'];
  inputs: z.infer<typeof scenarioSnapshotInputsSchema>;
  expectations: Scenario['expected'];
}): Scenario {
  const { scenarioTitle, request, history, spatial } = definition.inputs;
  return {
    id: definition.scenarioId,
    suite: definition.suite,
    title: scenarioTitle,
    request,
    ...(history !== undefined && { history }),
    ...(spatial !== undefined && { spatial }),
    expected: definition.expectations,
  };
}

/** Bounded regular-file JSON read used only with fixed code-owned canonical URLs. */
export function readScenarioSnapshot(
  url: URL,
  accountBytes?: (size: number) => void,
): unknown {
  const fd = openSync(
    url,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536)
      throw new Error('Scenario snapshot is not a bounded regular file');
    const bytes = Buffer.alloc(65_537);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (read === 0) break;
      size += read;
    }
    if (size > 65_536)
      throw new Error('Scenario snapshot exceeds JSON byte limit');
    accountBytes?.(size);
    return JSON.parse(bytes.subarray(0, size).toString('utf8'));
  } finally {
    closeSync(fd);
  }
}
