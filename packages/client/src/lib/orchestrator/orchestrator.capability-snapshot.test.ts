import { describe, expect, it, spyOn } from 'bun:test';

import type { Vessel } from '@maelstrom-co/protocol';
import {
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
  readCapabilitySnapshot,
} from '@maelstrom-co/protocol';

import { createTestOrchestrator } from '../../../test-utils/connector-mocks.js';
import { createTestVessel } from '../../../test-utils/vessel-fixtures.js';

describe('Orchestrator.getCapabilitySnapshot', () => {
  it('returns the projected snapshot of the registered vessels', () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.vesselManager.registerVessel(createTestVessel());

    // The orchestrator unwraps the projection: callers get the catalog, not
    // the developer-facing omission report that travels beside it.
    expect(orchestrator.getCapabilitySnapshot()).toEqual(
      readCapabilitySnapshot(orchestrator.vesselManager.getAll()).snapshot,
    );

    orchestrator.dispose();
  });

  it('warns once through the orchestrator logger about omitted options, then debugs', () => {
    const values = ['x'.repeat(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS + 1)];
    const { orchestrator } = createTestOrchestrator(undefined, { debug: true });
    orchestrator.vesselManager.registerVessel(vesselWithEnum(values));

    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      orchestrator.getCapabilitySnapshot();
      orchestrator.getCapabilitySnapshot();

      expect(warn).toHaveBeenCalledTimes(1);
      const [, warnedMessage] = warn.mock.calls[0] ?? [];
      expect(typeof warnedMessage).toBe('string');
      // Repeated at debug level rather than dropped: a snapshot is read on
      // every voice turn, so warning each time would flood the console.
      expect(
        debug.mock.calls.filter(([, message]) => message === warnedMessage),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
      debug.mockRestore();
      orchestrator.dispose();
    }
  });
});

function vesselWithEnum(values: readonly unknown[]): Vessel {
  return createTestVessel({
    id: 'map',
    defaultVariant: 'overview',
    variants: {
      overview: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'showRoute',
            description: 'Show directions to a destination',
            parameters: [
              {
                name: 'destination',
                type: 'string',
                description: 'Name of the destination',
                enum: [...values],
              },
            ],
          },
        ],
      },
    },
  });
}
