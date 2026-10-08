import { validateVessel } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { SHOP_LAYOUT } from '../lib/default-layout';
import { cartVessel } from './cart.vessel.def';
import { catalogVessel } from './catalog.vessel.def';
import { checkoutVessel } from './checkout.vessel.def';
import { ordersVessel } from './orders.vessel.def';

const SHOP_VESSELS = {
  orders: ordersVessel,
  catalog: catalogVessel,
  cart: cartVessel,
  checkout: checkoutVessel,
} as const;

describe('pet-shop vessel definitions', () => {
  it.each(
    Object.entries(SHOP_VESSELS),
  )('%s passes protocol validation', (_id, vessel) => {
    expect(validateVessel(vessel)).toMatchObject({ valid: true });
  });

  it('places every shop vessel in an existing variant in SHOP_LAYOUT', () => {
    expect(SHOP_LAYOUT.instances.map((i) => i.vesselId).sort()).toEqual(
      Object.keys(SHOP_VESSELS).sort(),
    );
    for (const instance of SHOP_LAYOUT.instances) {
      const vessel =
        SHOP_VESSELS[instance.vesselId as keyof typeof SHOP_VESSELS];
      expect(Object.keys(vessel.variants)).toContain(instance.variant);
    }
  });
});
