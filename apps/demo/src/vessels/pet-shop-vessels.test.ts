import { type ActionParameter, validateVessel } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { SHOP_LAYOUT } from '../lib/default-layout';
import {
  CATALOG_SKUS,
  CUSTOMER,
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  formatCents,
  TAX_RATE,
} from '../lib/pet-shop-fixtures';
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

  it('moves catalog to the product variant on showProductDetails', () => {
    const action = catalogVessel.variants.results.actions.find(
      (candidate) => candidate.name === 'showProductDetails',
    );
    expect(action?.transitionsTo).toBe('product');
  });

  it('moves checkout to the confirmation variant on placeOrder', () => {
    const action = checkoutVessel.variants.review.actions.find(
      (candidate) => candidate.name === 'placeOrder',
    );
    expect(action?.transitionsTo).toBe('confirmation');
  });

  it('offers only catalog SKUs as product parameters', () => {
    const addToCart = cartVessel.variants.items.actions.find(
      (candidate) => candidate.name === 'addToCart',
    );
    // `defineVessel` infers the literal parameter shape, which has no `enum`
    // key; `withActionOptions` adds it at runtime.
    const parameters: readonly ActionParameter[] = addToCart?.parameters ?? [];
    const sku = parameters.find((parameter) => parameter.name === 'sku');
    expect(sku?.enum).toEqual([...CATALOG_SKUS]);
  });

  it('quotes the fixture pricing and customer in the cart and orders descriptions', () => {
    expect(cartVessel.description).toContain(
      formatCents(FREE_SHIPPING_THRESHOLD_CENTS),
    );
    expect(cartVessel.description).toContain(formatCents(FLAT_SHIPPING_CENTS));
    expect(cartVessel.description).toContain(`${TAX_RATE * 100}% tax`);
    expect(ordersVessel.description).toContain(CUSTOMER.name);
    for (const pet of CUSTOMER.pets) {
      expect(ordersVessel.description).toContain(pet.name);
      expect(ordersVessel.description).toContain(pet.note);
    }
  });

  it('starts SHOP_LAYOUT with only orders and cart, each in a declared variant', () => {
    expect(SHOP_LAYOUT.instances.map((i) => i.vesselId).sort()).toEqual([
      'cart',
      'orders',
    ]);
    for (const instance of SHOP_LAYOUT.instances) {
      const vessel =
        SHOP_VESSELS[instance.vesselId as keyof typeof SHOP_VESSELS];
      expect(Object.keys(vessel.variants)).toContain(instance.variant);
    }
  });
});
