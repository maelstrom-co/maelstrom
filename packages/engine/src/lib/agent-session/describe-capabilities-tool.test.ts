import { describe, expect, test } from 'bun:test';

import {
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
  type Vessel,
  type VesselActionDefinition,
  validateVessel,
} from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import {
  createDescribeCapabilitiesToolEntry,
  DESCRIBE_CAPABILITIES_TOOL_NAME,
} from './describe-capabilities-tool.js';
import { executeToolCall } from './tool-executor.js';

describe('describe_capabilities tool', () => {
  test('is a read-only built-in named describe_capabilities', () => {
    const entry = createDescribeCapabilitiesToolEntry(context([]));

    expect(entry.tool.name).toBe(DESCRIBE_CAPABILITIES_TOOL_NAME);
    expect(DESCRIBE_CAPABILITIES_TOOL_NAME).toBe('describe_capabilities');
    expect(entry.sideEffect).toBe('read_only');
    expect(entry.tool.sideEffect).toBe('read_only');
    expect(entry.approval).toBe('never');
  });

  test('describes every Vessel when given no ids', async () => {
    const entry = createDescribeCapabilitiesToolEntry(
      context([vessel('catalog'), vessel('cart')]),
    );

    const result = await run(entry, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vesselIds(result.value)).toEqual(['catalog', 'cart']);
    expect(result.summary).toBe('described 2 Vessels');
  });

  test('describes only the given ids and ignores unknown ones', async () => {
    const entry = createDescribeCapabilitiesToolEntry(
      context([vessel('catalog'), vessel('cart')]),
    );

    const result = await run(entry, { vesselIds: ['cart', 'missing'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(vesselIds(result.value)).toEqual(['cart']);
    expect(result.summary).toBe('described 1 Vessel');
  });

  test('warns developers about option omissions once per run and never tells the model', async () => {
    const warnings: unknown[][] = [];
    const logger: Logger = {
      ...silentLogger,
      warn: (...args) => {
        warnings.push(args);
      },
    };
    const entry = createDescribeCapabilitiesToolEntry({
      ...context([
        vessel('map', [
          {
            name: 'route',
            description: 'Show a route',
            parameters: [
              {
                name: 'to',
                type: 'string',
                description: 'Destination',
                enum: ['x'.repeat(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS + 1)],
              },
            ],
          },
        ]),
      ]),
      logger,
    });

    const first = await run(entry, {});
    await run(entry, {});

    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain('optionOmissions');
  });
});

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function context(vessels: readonly Vessel[]) {
  return { vessels, logger: silentLogger, runId: 'run-1' };
}

function run(
  entry: ReturnType<typeof createDescribeCapabilitiesToolEntry>,
  args: unknown,
) {
  return executeToolCall(
    entry,
    args,
    { user: undefined },
    new AbortController().signal,
  );
}

function vesselIds(value: unknown): unknown[] {
  return (value as { vessels: { vesselId: unknown }[] }).vessels.map(
    (vessel) => vessel.vesselId,
  );
}

function vessel(
  id: string,
  actions: readonly VesselActionDefinition[] = [],
): Vessel {
  const result = validateVessel({
    id,
    name: id,
    description: `The ${id}`,
    defaultVariant: 'main',
    variants: {
      main: { props: {}, minSize: { width: 1, height: 1 }, actions },
    },
  });
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  return result.vessel;
}
