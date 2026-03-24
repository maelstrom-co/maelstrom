import { describe, it } from 'bun:test';

import type { ActionNames, VariantNames } from '@maelstrom-co/protocol-old';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';

describe('vessel()', () => {
  it('preserves literal types (eager overload)', () => {
    const entry = vessel(testVessel, () => null);

    const _variantName: VariantNames<typeof entry.vessel> = 'list';
    // @ts-expect-error - 'bogus' is not a valid variant name
    const _badVariant: VariantNames<typeof entry.vessel> = 'bogus';
    void [entry, _variantName, _badVariant];
  });

  it('preserves literal types (lazy overload)', () => {
    const entry = vessel(
      testVessel,
      async () => ({ default: () => null }),
      () => null,
    );

    const _actionName: ActionNames<typeof entry.vessel> = 'selectOrder';
    // @ts-expect-error - 'bogus' is not a valid action name
    const _badAction: ActionNames<typeof entry.vessel> = 'bogus';
    void [entry, _actionName, _badAction];
  });
});
