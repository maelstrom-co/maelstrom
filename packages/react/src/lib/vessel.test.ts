import { describe, it } from 'bun:test';

import type { VesselDefinition } from '@maelstrom-co/protocol';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';

type VariantNamesLocal<V extends VesselDefinition> =
  keyof V['variants'] & string;
type ActionNamesLocal<V extends VesselDefinition> =
  V['variants'][keyof V['variants']]['actions'][number]['name'];

describe('vessel()', () => {
  it('preserves literal types (eager overload)', () => {
    const entry = vessel(testVessel, () => null);

    const _variantName: VariantNamesLocal<typeof entry.vessel> = 'list';
    // @ts-expect-error - 'bogus' is not a valid variant name
    const _badVariant: VariantNamesLocal<typeof entry.vessel> = 'bogus';
    void [entry, _variantName, _badVariant];
  });

  it('preserves literal types (lazy overload)', () => {
    const entry = vessel(
      testVessel,
      async () => ({ default: () => null }),
      () => null,
    );

    const _actionName: ActionNamesLocal<typeof entry.vessel> = 'selectOrder';
    // @ts-expect-error - 'bogus' is not a valid action name
    const _badAction: ActionNamesLocal<typeof entry.vessel> = 'bogus';
    void [entry, _actionName, _badAction];
  });
});
