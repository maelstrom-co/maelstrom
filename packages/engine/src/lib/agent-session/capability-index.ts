import {
  readCapabilitySnapshot,
  sanitizeControlChars,
  type Vessel,
  vesselOnlyShows,
} from '@maelstrom-co/protocol';

import { DESCRIBE_CAPABILITIES_TOOL_NAME } from './describe-capabilities-tool.js';

/** Most characters the capability index block may take, header and pointer included. */
export const CAPABILITY_INDEX_MAX_CHARS = 4_000;

const HEADER = 'What the app can show:';

const POINTER = `- More Vessels exist. Call ${DESCRIBE_CAPABILITIES_TOOL_NAME} for the rest.`;

/**
 * Builds the system prompt block listing each Vessel with its sanitized
 * description and whether it only shows or can also change data. Names no
 * Action. Capped at {@link CAPABILITY_INDEX_MAX_CHARS}, ending with a
 * pointer to `describe_capabilities` when Vessels are left out.
 * @returns `undefined` for an empty Vessel list.
 */
export function buildCapabilityIndex(
  vessels: readonly Vessel[],
): string | undefined {
  if (vessels.length === 0) return undefined;
  const { snapshot } = readCapabilitySnapshot(vessels);
  const lines = snapshot.vessels.map((capability, index) => {
    const vessel = vessels[index] as Vessel;
    const marking = vesselOnlyShows(vessel)
      ? 'Shows only.'
      : 'Can also change data.';
    return `- ${sanitizeControlChars(capability.vesselId)}: ${capability.description.trim().replace(/\.$/, '')}. ${marking}`;
  });
  const complete = [HEADER, ...lines].join('\n');
  if (complete.length <= CAPABILITY_INDEX_MAX_CHARS) return complete;
  const kept = [HEADER];
  let length = HEADER.length + 1 + POINTER.length;
  for (const line of lines) {
    if (length + 1 + line.length > CAPABILITY_INDEX_MAX_CHARS) break;
    kept.push(line);
    length += 1 + line.length;
  }
  kept.push(POINTER);
  return kept.join('\n');
}
