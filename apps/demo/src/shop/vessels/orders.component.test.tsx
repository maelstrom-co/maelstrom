// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../maelstrom', () => ({
  shopM: { useActions: () => undefined },
}));

const { __resetOrdersStoreForTests, ordersActions } =
  await import('../stores/orders.store');
const OrdersComponent = (await import('./orders.component')).default;
const { OrdersSkeleton } = await import('./orders.skeleton');

beforeEach(() => {
  __resetOrdersStoreForTests();
});

afterEach(cleanup);

describe('orders vessel copy', () => {
  it('uses plain shop language in the list', () => {
    const view = render(<OrdersComponent {...props('list')} />);
    expect(view.getByText('Your orders')).toBeTruthy();
    expect(view.getByText('4 past orders')).toBeTruthy();
    expect(view.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(view.queryByText('delivered')).toBeNull();
  });

  it('keeps each row a button whose name contains the order id', () => {
    const view = render(<OrdersComponent {...props('list')} />);
    const row = view.getByRole('button', { name: /ORD-10455/ });
    expect(row.tagName).toBe('BUTTON');
  });

  it('asks the shopper to pick an order when none is selected', () => {
    const view = render(<OrdersComponent {...props('detail')} />);
    expect(view.getByText('Order details')).toBeTruthy();
    expect(view.getByText('← All your orders')).toBeTruthy();
    expect(view.getByText('Pick an order to see what was in it.')).toBeTruthy();
    expect(
      view.getByText('Ask for your last order or one by number.'),
    ).toBeTruthy();
  });

  it('shows the order id and item names in the detail', () => {
    ordersActions.showOrderDetails('ORD-10455');
    const view = render(<OrdersComponent {...props('detail')} />);
    expect(view.getByText('ORD-10455')).toBeTruthy();
    expect(view.getByText('DOG-DRY-SUMMIT-ADULT-30')).toBeTruthy();
  });

  it('goes back through the backToOrderList action', () => {
    ordersActions.showOrderDetails('ORD-10455');
    const executeAction = vi.fn();
    const view = render(
      <OrdersComponent {...props('detail', executeAction)} />,
    );
    fireEvent.click(view.getByText('← All your orders'));
    expect(executeAction).toHaveBeenCalledWith('backToOrderList');
  });

  it('skeleton says just a moment', () => {
    const view = render(<OrdersSkeleton vesselId="orders" />);
    expect(view.getByText('Just a moment…')).toBeTruthy();
  });
});

function props(
  variant: string,
  executeAction: unknown = vi.fn(),
): TypedVesselProps<never> {
  return {
    instanceId: 'test',
    variantProps: { variant },
    executeAction,
  } as unknown as TypedVesselProps<never>;
}
