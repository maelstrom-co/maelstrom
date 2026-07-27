import type { Vessel, VesselDefinition } from '@maelstrom-co/protocol';

// Pre-validation author shape (raw strings); cast to `Vessel` at the
// boundary so fixtures stay readable while the projection under test still
// receives the branded post-validation type.
export function createTestVessel(
  overrides?: Partial<VesselDefinition>,
): Vessel {
  const vessel: VesselDefinition = {
    id: 'test-vessel',
    name: 'Test Vessel',
    description: 'A test vessel for validation',
    defaultVariant: 'default',
    variants: {
      default: {
        description: 'Default variant',
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'testAction',
            description: 'Test action',
            parameters: [
              {
                name: 'param1',
                type: 'string',
                description: 'A string parameter',
                required: true,
              },
            ],
          },
        ],
      },
    },
    ...overrides,
  };
  return vessel as Vessel;
}
