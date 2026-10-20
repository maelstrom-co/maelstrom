import {
  type VesselActionDefinition,
  type VesselDefinition,
  validateVessel,
} from '@maelstrom-co/protocol';
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

  it.each([
    ['orders', 'list', 'showOrderDetails', 'detail'],
    ['orders', 'list', 'showMostRecentOrder', 'detail'],
    ['orders', 'detail', 'backToOrderList', 'list'],
    ['catalog', 'results', 'showProductDetails', 'product'],
    ['catalog', 'product', 'searchProducts', 'results'],
    ['catalog', 'product', 'findSimilarProducts', 'results'],
    ['catalog', 'product', 'clearSearch', 'results'],
    ['catalog', 'product', 'backToResults', 'results'],
    ['checkout', 'review', 'placeOrder', 'confirmation'],
    ['checkout', 'confirmation', 'returnToCheckoutReview', 'review'],
  ] as const)('moves %s from %s to the target variant on %s', (vesselId, variant, action, target) => {
    expect(declaredAction(vesselId, variant, action)?.transitionsTo).toBe(
      target,
    );
  });

  it('declares no transitions on the cart actions', () => {
    const vessel: VesselDefinition = cartVessel;
    const actions = Object.values(vessel.variants).flatMap(
      (variant) => variant.actions,
    );
    expect(actions).not.toHaveLength(0);
    expect(
      actions.filter((action) => action.transitionsTo !== undefined),
    ).toEqual([]);
  });

  it.each([
    ['cart', 'items', 'addToCart', 'sku', CATALOG_SKUS],
    ['catalog', 'results', 'searchProducts', 'species', ['dog', 'cat']],
    ['catalog', 'results', 'searchProducts', 'foodType', ['dry', 'wet']],
    ['catalog', 'results', 'findSimilarProducts', 'sku', CATALOG_SKUS],
    ['catalog', 'results', 'showProductDetails', 'sku', CATALOG_SKUS],
    ['catalog', 'product', 'searchProducts', 'species', ['dog', 'cat']],
    ['catalog', 'product', 'searchProducts', 'foodType', ['dry', 'wet']],
    ['catalog', 'product', 'findSimilarProducts', 'sku', CATALOG_SKUS],
    ['catalog', 'product', 'showProductDetails', 'sku', CATALOG_SKUS],
  ] as const)('offers an enum on %s %s.%s %s', (vesselId, variant, action, parameter, values) => {
    const declared = declaredAction(
      vesselId,
      variant,
      action,
    )?.parameters?.find((candidate) => candidate.name === parameter);
    expect(declared?.enum).toEqual([...values]);
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

function declaredAction(
  vesselId: keyof typeof SHOP_VESSELS,
  variant: string,
  action: string,
): VesselActionDefinition | undefined {
  const vessel: VesselDefinition = SHOP_VESSELS[vesselId];
  return vessel.variants[variant]?.actions.find(
    (candidate) => candidate.name === action,
  );
}
