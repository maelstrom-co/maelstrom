import { describe, it } from 'bun:test';

import type { TypedVesselProps, VesselIds } from './vessel-entry-types.js';
import { vessel } from './vessel.js';
import { testVessel, type TestVessel } from './__tests__/test-vessel.fixture';

describe('TypedVesselProps', () => {
  it('has correct executeAction constraint', () => {
    const _props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1',
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: (name, params) => {
        void [name, params];
      },
    };
    _props.executeAction('selectOrder', { orderId: 'ord-1' });
    _props.executeAction('refresh');
    void _props;
  });

  it('rejects invalid action names in executeAction', () => {
    const props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1',
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: () => {},
    };
    // @ts-expect-error - 'badAction' is not a valid action name
    props.executeAction('badAction');
    void props;
  });
});

describe('VesselIds', () => {
  it('extracts union of vessel IDs from tuple', () => {
    const entry = vessel(testVessel, () => null);
    type Ids = VesselIds<[typeof entry]>;
    const _id: Ids = 'orders';
    // @ts-expect-error - 'other' is not a valid vessel ID
    const _badId: Ids = 'other';
    void [_id, _badId];
  });
});
