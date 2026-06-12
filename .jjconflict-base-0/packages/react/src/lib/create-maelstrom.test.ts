import { describe, it } from 'bun:test';

import { defineVessel } from '@maelstrom-co/protocol';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';

describe('createMaelstrom', () => {
  it('accepts entries with literal IDs', () => {
    const entry = vessel(testVessel, () => null);
    const instance = createMaelstrom({ vessels: [entry] });
    void instance;
  });

  it('rejects entries with widened id: string', () => {
    const widenedVessel = defineVessel({
      id: 'orders' as string,
      name: 'Orders',
      description: 'Order management vessel',
      defaultVariant: 'list',
      variants: {
        list: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });
    const entry = vessel(widenedVessel, () => null);
    // @ts-expect-error - widened string ID should be rejected
    const _instance = createMaelstrom({ vessels: [entry] });
    void _instance;
  });
});
