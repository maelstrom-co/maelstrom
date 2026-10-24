import { useSyncExternalStore } from 'react';
import { cartActions, cartTotals, getCartSnapshot } from './cart.store';
import { CUSTOMER, formatAddress, type Order } from './fixtures';
import { ordersActions } from './orders.store';

export interface OrderConfirmation {
  order: Order;
  shipTo: string;
  paymentMethod: string;
}

interface CheckoutState {
  lastConfirmation: OrderConfirmation | null;
}

const INITIAL_STATE: CheckoutState = { lastConfirmation: null };

let state: CheckoutState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useCheckoutStore(): CheckoutState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCheckoutSnapshot(): CheckoutState {
  return state;
}

export function __resetCheckoutStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const checkoutActions = {
  placeOrder(today: Date = new Date()): OrderConfirmation | null {
    const { lines } = getCartSnapshot();
    if (lines.length === 0) return null;
    const order: Order = {
      id: ordersActions.nextOrderId(),
      placedOn: isoDate(today),
      status: 'processing',
      items: lines.map((line) => ({ ...line })),
      totals: cartTotals(lines),
    };
    ordersActions.recordOrder(order);
    cartActions.clearCart();
    const confirmation: OrderConfirmation = {
      order,
      shipTo: `${CUSTOMER.shippingAddress.name}, ${formatAddress(CUSTOMER.shippingAddress)}`,
      paymentMethod: CUSTOMER.paymentMethod.label,
    };
    setState({ lastConfirmation: confirmation });
    return confirmation;
  },
  returnToCheckoutReview(): void {
    setState(INITIAL_STATE);
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CheckoutState {
  return state;
}

function setState(next: CheckoutState): void {
  state = next;
  for (const l of listeners) l();
}

// Local calendar date, not `toISOString()`, which would shift to UTC.
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
