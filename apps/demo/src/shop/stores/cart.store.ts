import { createReferenceResolver } from '@maelstrom-co/client';
import { err, ok } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';

import { findProduct } from './catalog.store';
import {
  CATALOG_SKUS,
  calculateOrderTotals,
  type OrderLineItem,
  type OrderTotals,
  type Product,
} from './fixtures';

export type CartLine = OrderLineItem;

interface CartState {
  lines: readonly CartLine[];
}

export type CartMutationResult =
  | { ok: true; line: CartLine | null }
  | { ok: false; reason: 'unknown_product' | 'not_in_cart' | 'bad_quantity' }
  | { ok: false; reason: 'ambiguous'; candidates: readonly string[] };

interface CartActionRequest {
  sku: string;
  quantity?: number;
  quantityRule?: string;
}

const INITIAL_STATE: CartState = { lines: [] };

let state: CartState = INITIAL_STATE;

const cartLineResolver = createReferenceResolver({
  items: () => state.lines,
  id: (line) => line.sku,
  title: (line) => line.name,
});

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
    const match = cartLineResolver.resolve(skuOrName);
    if (match.kind === 'ambiguous') {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: match.candidates.map((line) => line.sku),
      };
    }
    if (match.kind === 'not_found') return { ok: false, reason: 'not_in_cart' };
    setState({ lines: state.lines.filter((l) => l.sku !== match.item.sku) });
    return { ok: true, line: null };
  },
  updateCartQuantity(skuOrName: string, quantity: number): CartMutationResult {
    if (quantity === 0) return cartActions.removeFromCart(skuOrName);
    if (!isPositiveInteger(quantity))
      return { ok: false, reason: 'bad_quantity' };
    const match = cartLineResolver.resolve(skuOrName);
    if (match.kind === 'ambiguous') {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: match.candidates.map((line) => line.sku),
      };
    }
    if (match.kind === 'not_found') return { ok: false, reason: 'not_in_cart' };
    const line = { ...match.item, quantity };
    setState({
      lines: state.lines.map((l) => (l.sku === line.sku ? line : l)),
    });
    return { ok: true, line };
  },
  clearCart(): void {
    setState(INITIAL_STATE);
  },
};

export function cartResultToAction(
  result: CartMutationResult,
  { sku, quantity, quantityRule }: CartActionRequest,
) {
  if (result.ok) return ok(undefined);
  switch (result.reason) {
    case 'unknown_product':
      return err(
        new Error(
          `No catalog product matches "${sku}". Available SKUs: ${CATALOG_SKUS.join(', ')}`,
        ),
      );
    case 'not_in_cart': {
      const inCart = state.lines.map((line) => line.sku).join(', ');
      return err(
        new Error(
          `"${sku}" is not in the cart. Cart SKUs: ${inCart || '(cart is empty)'}`,
        ),
      );
    }
    case 'ambiguous':
      return err(
        new Error(
          `"${sku}" matches more than one cart line: ${result.candidates.join(', ')}. Pass the SKU.`,
        ),
      );
    case 'bad_quantity':
      return err(
        new Error(`quantity must be ${quantityRule}, got ${quantity}`),
      );
  }
}

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
