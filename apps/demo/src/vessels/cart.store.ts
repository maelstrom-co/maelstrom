import { useSyncExternalStore } from 'react';
import {
  calculateOrderTotals,
  type OrderLineItem,
  type OrderTotals,
  type Product,
} from '../lib/pet-shop-fixtures';
import { findProduct } from './catalog.store';

export type CartLine = OrderLineItem;

interface CartState {
  lines: readonly CartLine[];
}

export type CartMutationResult =
  | { ok: true; line: CartLine | null }
  | { ok: false; reason: 'unknown_product' | 'not_in_cart' | 'bad_quantity' };

const INITIAL_STATE: CartState = { lines: [] };

let state: CartState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useCartStore(): CartState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCartSnapshot(): CartState {
  return state;
}

export function cartTotals(
  lines: readonly CartLine[] = state.lines,
): OrderTotals {
  return calculateOrderTotals(lines);
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetCartStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const cartActions = {
  addToCart(skuOrName: string, quantity = 1): CartMutationResult {
    if (!isPositiveInteger(quantity))
      return { ok: false, reason: 'bad_quantity' };
    const product = findProduct(skuOrName);
    if (!product) return { ok: false, reason: 'unknown_product' };
    const existing = state.lines.find((line) => line.sku === product.sku);
    const line: CartLine = existing
      ? { ...existing, quantity: existing.quantity + quantity }
      : lineFor(product, quantity);
    setState({
      lines: existing
        ? state.lines.map((l) => (l.sku === product.sku ? line : l))
        : [...state.lines, line],
    });
    return { ok: true, line };
  },
  removeFromCart(skuOrName: string): CartMutationResult {
    const line = findLine(skuOrName);
    if (!line) return { ok: false, reason: 'not_in_cart' };
    setState({ lines: state.lines.filter((l) => l.sku !== line.sku) });
    return { ok: true, line: null };
  },
  updateCartQuantity(skuOrName: string, quantity: number): CartMutationResult {
    if (quantity === 0) return cartActions.removeFromCart(skuOrName);
    if (!isPositiveInteger(quantity))
      return { ok: false, reason: 'bad_quantity' };
    const existing = findLine(skuOrName);
    if (!existing) return { ok: false, reason: 'not_in_cart' };
    const line = { ...existing, quantity };
    setState({
      lines: state.lines.map((l) => (l.sku === existing.sku ? line : l)),
    });
    return { ok: true, line };
  },
  clearCart(): void {
    setState(INITIAL_STATE);
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CartState {
  return state;
}

function setState(next: CartState): void {
  state = next;
  for (const l of listeners) l();
}

function findLine(skuOrName: string): CartLine | undefined {
  const product = findProduct(skuOrName);
  return product
    ? state.lines.find((line) => line.sku === product.sku)
    : undefined;
}

function lineFor(product: Product, quantity: number): CartLine {
  return {
    sku: product.sku,
    name: product.name,
    quantity,
    unitPriceCents: product.priceCents,
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
