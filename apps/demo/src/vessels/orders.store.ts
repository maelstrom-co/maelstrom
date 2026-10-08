import { useSyncExternalStore } from 'react';
import { type Order, SEED_ORDERS } from '../lib/pet-shop-fixtures';

interface OrdersState {
  /** Newest first. */
  orders: readonly Order[];
  selectedOrderId: string | null;
}

const INITIAL_STATE: OrdersState = {
  orders: SEED_ORDERS,
  selectedOrderId: null,
};

let state: OrdersState = INITIAL_STATE;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): OrdersState {
  return state;
}

function setState(next: OrdersState): void {
  state = next;
  for (const l of listeners) l();
}

export function useOrdersStore(): OrdersState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getOrdersSnapshot(): OrdersState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetOrdersStoreForTests(): void {
  setState(INITIAL_STATE);
}

/** Matches `ORD-10421`, `ord-10421` or the bare number `10421`. */
export function findOrder(orderId: string): Order | undefined {
  const digits = orderId
    .trim()
    .toUpperCase()
    .replace(/^ORD-?/, '');
  return state.orders.find((order) => order.id === `ORD-${digits}`);
}

export const ordersActions = {
  showOrderDetails(orderId: string): Order | null {
    const order = findOrder(orderId);
    if (!order) return null;
    setState({ ...state, selectedOrderId: order.id });
    return order;
  },
  showMostRecentOrder(): Order | null {
    const [latest] = state.orders;
    if (!latest) return null;
    setState({ ...state, selectedOrderId: latest.id });
    return latest;
  },
  backToOrderList(): void {
    setState({ ...state, selectedOrderId: null });
  },
  recordOrder(order: Order): void {
    setState({ ...state, orders: [order, ...state.orders] });
  },
  nextOrderId(): string {
    const highest = Math.max(
      10000,
      ...state.orders.map((order) => Number(order.id.replace('ORD-', ''))),
    );
    return `ORD-${highest + 1}`;
  },
};
