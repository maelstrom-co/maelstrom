import { describe, expect, it, mock } from 'bun:test';
import type {
  SessionId,
  MaelstromResponse,
  Vessel,
  VesselDefinition,
} from '@maelstrom-co/protocol';

import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { readCapabilitySnapshot } from './capability-snapshot.js';

// ============================================================================
// Test helpers (mirrors ui-structural-snapshot.test.ts)
// ============================================================================

function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock((_sessionId: SessionId) => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    process: mock(() => Promise.resolve({} as MaelstromResponse)),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe =>
        () => {},
    ),
    addAssistantMessage: mock(() => Promise.resolve()),
    getHistory: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function createTestOrchestrator() {
  return new Orchestrator(createMockConnector(), {});
}

// Pre-validation author shape (raw strings); cast to `Vessel` at the
// boundary so fixtures stay readable while the projection under test still
// receives the branded post-validation type (mirrors vessel-manager.test.ts).
function createTestVessel(overrides?: Partial<VesselDefinition>): Vessel {
  const vessel: VesselDefinition = {
    id: 'weather',
    name: 'Weather',
    description: 'Shows current weather conditions',
    defaultVariant: 'compact',
    variants: {
      compact: {
        description: 'Small tile with temperature only',
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'expand',
            description: 'Expand to the detailed forecast view',
            transitionsTo: 'detailed',
          },
        ],
      },
      detailed: {
        description: 'Full forecast with hourly breakdown',
        props: {},
        minSize: { width: 2, height: 2 },
        actions: [
          {
            name: 'collapse',
            description: 'Collapse back to the compact tile',
            transitionsTo: 'compact',
          },
        ],
      },
    },
    ...overrides,
  };
  return vessel as Vessel;
}

describe('readCapabilitySnapshot', () => {
  it('projects vessel purpose, variants, and actions', () => {
    const snapshot = readCapabilitySnapshot([createTestVessel()]);

    expect(snapshot.vessels).toHaveLength(1);
    const [capability] = snapshot.vessels;
    expect(capability).toBeDefined();
    if (!capability) return;

    expect(capability.vesselId).toBe('weather');
    expect(capability.description).toBe('Shows current weather conditions');
    expect(capability.variants).toEqual([
      { name: 'compact', description: 'Small tile with temperature only' },
      { name: 'detailed', description: 'Full forecast with hourly breakdown' },
    ]);
    expect(capability.actions).toEqual(
      expect.arrayContaining([
        { name: 'expand', description: 'Expand to the detailed forecast view' },
        { name: 'collapse', description: 'Collapse back to the compact tile' },
      ]),
    );
    expect(capability.actions).toHaveLength(2);
  });

  it('omits a variant description when the variant has none', () => {
    const vessel = createTestVessel({
      variants: {
        compact: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });

    const snapshot = readCapabilitySnapshot([vessel]);
    const [capability] = snapshot.vessels;
    expect(capability?.variants).toEqual([{ name: 'compact' }]);
    expect(capability?.variants[0] && 'description' in capability.variants[0]).toBe(
      false,
    );
  });

  it('deduplicates actions with the same name across variants', () => {
    const vessel = createTestVessel({
      variants: {
        compact: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            { name: 'refresh', description: 'Refresh the current forecast' },
          ],
        },
        detailed: {
          props: {},
          minSize: { width: 2, height: 2 },
          actions: [
            { name: 'refresh', description: 'Refresh the current forecast' },
          ],
        },
      },
    });

    const snapshot = readCapabilitySnapshot([vessel]);
    const [capability] = snapshot.vessels;
    expect(capability?.actions).toEqual([
      { name: 'refresh', description: 'Refresh the current forecast' },
    ]);
  });

  it('excludes action parameters, size constraints, and props (leak test)', () => {
    const vessel = createTestVessel({
      variants: {
        compact: {
          description: 'Small tile',
          // Nested, data-ish content that must never reach the catalog.
          props: { location: { lat: 1, lon: 2 }, secretApiKey: 'sk-leak' },
          minSize: { width: 3, height: 4 },
          actions: [
            {
              name: 'setLocation',
              description: 'Set the displayed location',
              parameters: [
                {
                  name: 'query',
                  type: 'string',
                  description: 'Search query',
                  required: true,
                  defaultValue: 'nyc',
                  enum: ['nyc', 'sf'],
                },
              ],
              transitionsTo: 'compact',
            },
          ],
        },
      },
    });

    const snapshot = readCapabilitySnapshot([vessel]);

    expect(Object.keys(snapshot).sort()).toEqual(['vessels']);

    const [capability] = snapshot.vessels;
    expect(capability).toBeDefined();
    if (!capability) return;
    expect(Object.keys(capability).sort()).toEqual([
      'actions',
      'description',
      'variants',
      'vesselId',
    ]);

    for (const variant of capability.variants) {
      expect(Object.keys(variant).sort()).toEqual(
        variant.description === undefined ? ['name'] : ['description', 'name'],
      );
    }

    for (const action of capability.actions) {
      expect(Object.keys(action).sort()).toEqual(['description', 'name']);
    }
  });

  it('is exposed via Orchestrator.getCapabilitySnapshot()', () => {
    const orchestrator = createTestOrchestrator();
    orchestrator.vesselManager.registerVessel(createTestVessel());

    expect(orchestrator.getCapabilitySnapshot()).toEqual(
      readCapabilitySnapshot(orchestrator.vesselManager.getAll()),
    );

    orchestrator.dispose();
  });
});
