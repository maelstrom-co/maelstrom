// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../maelstrom', () => ({
  shopM: { useActions: () => undefined },
}));

const { __resetCartStoreForTests, cartActions } =
  await import('../stores/cart.store');
const { __resetCheckoutStoreForTests, checkoutActions } =
  await import('../stores/checkout.store');
const CheckoutComponent = (await import('./checkout.component')).default;
const { CheckoutSkeleton } = await import('./checkout.skeleton');

beforeEach(() => {
  __resetCartStoreForTests();
  __resetCheckoutStoreForTests();
});

afterEach(cleanup);

describe('checkout vessel copy', () => {
  it('uses plain shop language on the review variant', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    const view = render(<CheckoutComponent {...props('review')} />);
    expect(view.getByText("What's in the box")).toBeTruthy();
    expect(view.getByText('Shipping to')).toBeTruthy();
    expect(view.getByText('Paying with')).toBeTruthy();
    expect(view.getByText('Place order')).toBeTruthy();
  });

  it('caps the item list at two lines and summarises the rest', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    cartActions.addToCart('DOG-DRY-SUMMIT-ADULT-30');
    cartActions.addToCart('DOG-DRY-NORTHPAW-LEAN-28');
    const view = render(<CheckoutComponent {...props('review')} />);
    expect(view.getAllByText(/^\d+× /)).toHaveLength(2);
    expect(view.getByText('and 1 more')).toBeTruthy();
  });

  it('shows total and demo note on the confirmation variant', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    checkoutActions.placeOrder();
    const view = render(<CheckoutComponent {...props('confirmation')} />);
    expect(view.getByText('Order placed')).toBeTruthy();
    expect(view.getByText('Total')).toBeTruthy();
    expect(view.getByText(/Demo order, nothing charged/)).toBeTruthy();
  });

  it('shows a friendly loading label on the skeleton', () => {
    const view = render(<CheckoutSkeleton vesselId="checkout" />);
    expect(view.getByText('Just a moment…')).toBeTruthy();
  });
});

function props(variant: string): TypedVesselProps<never> {
  return {
    instanceId: 'test',
    variantProps: { variant },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<never>;
}
