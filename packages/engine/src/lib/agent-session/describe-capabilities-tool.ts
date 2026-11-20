import {
  type CapabilitySnapshot,
  readCapabilitySnapshot,
  type Vessel,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import type { Logger } from '../logger.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/** Name the loop model calls the built-in capability catalog tool by. */
export const DESCRIBE_CAPABILITIES_TOOL_NAME = 'describe_capabilities';

/** What one Agent Run's `describe_capabilities` tool reads from. */
export interface DescribeCapabilitiesContext {
  /** The Vessels of the utterance Chart the run started from. */
  readonly vessels: readonly Vessel[];
  /** Receives the once-per-run warning about omitted option values. */
  readonly logger: Logger;
  /** The run the tool belongs to, attached to the warning. */
  readonly runId: string;
}

/** Input of `describe_capabilities`. */
export interface DescribeCapabilitiesInput {
  /** Vessels to describe. Every Vessel when absent. Unknown ids are ignored. */
  readonly vesselIds?: readonly string[];
}

const inputSchema = z.object({
  vesselIds: z
    .array(z.string())
    .optional()
    .describe('Only these Vessels. Leave out to describe every Vessel.'),
});

const outputSchema = z.object({ vessels: z.array(z.unknown()) });

const DESCRIPTION = [
  'Describes what the app can show: each Vessel with its Variants, Actions and parameters.',
  'Call it when the capability list in your instructions is not enough to decide.',
  'Pass vesselIds to describe only some Vessels.',
].join(' ');

/**
 * Builds the `describe_capabilities` entry of one Agent Run. It returns the
 * capability snapshot of the run's Vessels. Option values the projection
 * omits are logged once per run as a warning and never reach the model.
 */
export function createDescribeCapabilitiesToolEntry(
  context: DescribeCapabilitiesContext,
): ToolRegistryEntry {
  let warned = false;
  const summarize = (output: unknown) =>
    `described ${(output as CapabilitySnapshot).vessels.length} Vessels`;
  return {
    tool: {
      name: DESCRIBE_CAPABILITIES_TOOL_NAME,
      description: DESCRIPTION,
      input: inputSchema,
      output: outputSchema,
      locus: 'server',
      sideEffect: 'read_only',
      approval: 'never',
      execute: (input) => {
        const { vesselIds } = input as DescribeCapabilitiesInput;
        const wanted = vesselIds === undefined ? undefined : new Set(vesselIds);
        const vessels =
          wanted === undefined
            ? context.vessels
            : context.vessels.filter((vessel) => wanted.has(vessel.id));
        const { snapshot, optionOmissions } = readCapabilitySnapshot(vessels);
        if (optionOmissions.length > 0 && !warned) {
          warned = true;
          context.logger.warn(
            'describe_capabilities omitted declared option values from the model',
            { runId: context.runId, optionOmissions },
          );
        }
        return Promise.resolve(snapshot);
      },
      summarize,
    },
    locus: 'server',
    sideEffect: 'read_only',
    approval: 'never',
    summarize,
  };
}
